/**
 * Plain-language layer for reports. Pure, deterministic helpers that translate
 * developer metrics (commits, lines, directories, categories) into wording a
 * non-technical reader — a manager, PM, or executive — can understand at a
 * glance. Used by the LLM prompt (as grounding facts) and the template fallback
 * (rendered directly), so every report channel speaks the same plain language.
 *
 * No IO — trivially unit-testable.
 */

export type ActivityLevel = "quiet" | "light" | "steady" | "busy" | "very-busy";

/**
 * A human "how much happened" label, normalized by the length of the period so
 * that 15 updates in a day and 15 in a quarter don't read the same. Rate is
 * updates-per-day; the thresholds are deliberately coarse (this is a feel, not a
 * score).
 */
export function activityLevel(
  commits: number,
  days: number
): { level: ActivityLevel; label: string } {
  if (commits <= 0) {
    return { level: "quiet", label: "No activity" };
  }
  const perDay = commits / Math.max(1, days);
  if (perDay < 1) {
    return { level: "light", label: "Light activity" };
  }
  if (perDay < 4) {
    return { level: "steady", label: "Steady activity" };
  }
  if (perDay < 10) {
    return { level: "busy", label: "Busy period" };
  }
  return { level: "very-busy", label: "Very busy period" };
}

/** Developer commit categories → plain-language work descriptions. */
const CATEGORY_LABELS: Record<string, string> = {
  Feature: "new features",
  Fix: "bug fixes",
  Refactor: "code clean-up",
  Docs: "documentation",
  Test: "testing",
  Chore: "maintenance",
  Perf: "performance work",
  Build: "build & tooling",
  Other: "other work"
};

export type WorkMix = { text: string; top: { label: string; pct: number }[] };

/**
 * Turns the commit-category tally into a plain phrase like
 * "mostly bug fixes (45%), new features (30%)". Returns the top three by share.
 */
export function humanizeWorkMix(categories: Record<string, number>): WorkMix {
  const entries = Object.entries(categories).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (total === 0) {
    return { text: "", top: [] };
  }
  const top = entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => ({
      label: CATEGORY_LABELS[category] ?? category.toLowerCase(),
      pct: Math.round((count / total) * 100)
    }));

  const phrase = top.map((item) => `${item.label} (${item.pct}%)`).join(", ");
  const text = top[0] && top[0].pct >= 50 ? `mostly ${phrase}` : phrase;
  return { text, top };
}

/** Common repo directories → business-readable area names. */
const AREA_LABELS: Record<string, string> = {
  api: "Backend",
  backend: "Backend",
  server: "Backend",
  web: "Frontend",
  frontend: "Frontend",
  client: "Frontend",
  ui: "UI",
  components: "UI components",
  app: "App",
  apps: "App",
  mobile: "Mobile app",
  ios: "Mobile app",
  android: "Mobile app",
  src: "Core code",
  lib: "Libraries",
  libs: "Libraries",
  packages: "Shared packages",
  shared: "Shared code",
  common: "Shared code",
  core: "Core code",
  prisma: "Database",
  migrations: "Database",
  migration: "Database",
  db: "Database",
  database: "Database",
  models: "Data models",
  schema: "Data models",
  docs: "Documentation",
  doc: "Documentation",
  test: "Tests",
  tests: "Tests",
  __tests__: "Tests",
  e2e: "Tests",
  config: "Configuration",
  scripts: "Scripts",
  infra: "Infrastructure",
  deploy: "Infrastructure",
  ".github": "CI / automation",
  ci: "CI / automation",
  public: "Assets",
  assets: "Assets",
  static: "Assets",
  styles: "Styling",
  css: "Styling",
  "(root)": "Project root"
};

function titleCase(value: string): string {
  return value
    .split(/[-_/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Maps a coarse "module" (a top-level directory bucket) to a business-readable
 * area name. Falls back to a title-cased version of the directory so an unknown
 * area still reads better than a raw path segment.
 */
export function humanizeArea(module: string): string {
  const key = module.toLowerCase();
  return AREA_LABELS[key] ?? (titleCase(module) || module);
}

/** De-duplicated, human area names for a list of modules (keeps input order). */
export function humanizeAreas(modules: { module: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of modules) {
    const label = humanizeArea(item.module);
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

/**
 * A deterministic 2–4 sentence executive summary in plain language, used by the
 * template fallback (and as a quality floor the LLM improves on). Deliberately
 * avoids developer jargon: "updates" not "commits", "people" not "contributors".
 */
export function buildPlainSummary(input: {
  commits: number;
  days: number;
  contributors: number;
  workMixText: string;
  topAreas: string[];
  topContributor: string | null;
  commitsDeltaPct: number | null;
  attentionCount: number;
}): string {
  const { commits, days, contributors, workMixText, topAreas, topContributor } = input;

  if (commits <= 0) {
    return "No development activity was recorded for this target in this period. If that looks wrong, collect the latest activity on the Repositories page and generate the report again.";
  }

  const level = activityLevel(commits, days);
  const people = contributors === 1 ? "1 person" : `${contributors} people`;
  const updates = commits === 1 ? "1 update" : `${commits} updates`;

  const sentences: string[] = [];
  sentences.push(`${level.label}: ${people} made ${updates} over ${days} day${days === 1 ? "" : "s"}.`);

  if (workMixText) {
    const areaClause = topAreas.length
      ? `, focused on ${topAreas.slice(0, 3).join(", ")}`
      : "";
    sentences.push(`The work was ${workMixText}${areaClause}.`);
  } else if (topAreas.length) {
    sentences.push(`Work focused on ${topAreas.slice(0, 3).join(", ")}.`);
  }

  if (topContributor) {
    sentences.push(`${topContributor} was the most active.`);
  }

  if (input.commitsDeltaPct !== null && input.commitsDeltaPct !== 0) {
    const dir = input.commitsDeltaPct > 0 ? "up" : "down";
    sentences.push(
      `Overall activity was ${dir} ${Math.abs(input.commitsDeltaPct)}% compared with the period before.`
    );
  }

  if (input.attentionCount > 0) {
    const items = input.attentionCount === 1 ? "1 item" : `${input.attentionCount} items`;
    sentences.push(`${items} may need a closer look (see below).`);
  }

  return sentences.join(" ");
}

/**
 * Trust-calibration notes appended to every report, so a non-technical reader
 * knows what the numbers do and don't cover — missing baseline, unlinked
 * contributors, skipped repositories. Deterministic; kept separate from the
 * qualitative narrative so it can never be paraphrased away.
 */
export function buildCaveats(input: {
  hasBaseline: boolean;
  unmappedContributors: number;
  skippedRepositories: number;
}): string[] {
  const caveats: string[] = [];

  if (!input.hasBaseline) {
    caveats.push(
      "No activity was recorded in the previous period, so trend comparisons aren't shown this time."
    );
  }
  if (input.unmappedContributors > 0) {
    const n = input.unmappedContributors;
    caveats.push(
      `${n} contributor${n === 1 ? "" : "s"} ${n === 1 ? "isn't" : "aren't"} linked to a team member yet — their work is listed under their Git username. Link them on the Contributors page for cleaner reports.`
    );
  }
  if (input.skippedRepositories > 0) {
    const n = input.skippedRepositories;
    caveats.push(
      `${n} repositor${n === 1 ? "y" : "ies"} couldn't be read during collection, so this report may be incomplete.`
    );
  }

  return caveats;
}
