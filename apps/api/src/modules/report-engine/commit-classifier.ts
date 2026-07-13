export const COMMIT_CATEGORIES = [
  "Feature",
  "Fix",
  "Refactor",
  "Docs",
  "Test",
  "Chore",
  "Perf",
  "Build",
  "Other"
] as const;

export type CommitCategory = (typeof COMMIT_CATEGORIES)[number];

const PREFIX_MAP: Record<string, CommitCategory> = {
  feat: "Feature",
  feature: "Feature",
  fix: "Fix",
  bugfix: "Fix",
  hotfix: "Fix",
  bug: "Fix",
  revert: "Fix",
  refactor: "Refactor",
  refac: "Refactor",
  cleanup: "Refactor",
  style: "Refactor",
  docs: "Docs",
  doc: "Docs",
  test: "Test",
  tests: "Test",
  chore: "Chore",
  deps: "Chore",
  dep: "Chore",
  config: "Chore",
  setup: "Chore",
  init: "Chore",
  build: "Build",
  ci: "Build",
  release: "Build",
  deploy: "Build",
  perf: "Perf"
};

/**
 * Classifies a commit by its subject line. A conventional-commit prefix wins
 * first (`feat:`, `fix(scope):`, `chore!:` …); otherwise a prioritized set of
 * keyword / imperative-verb patterns catches the messy real-world messages that
 * plain teams write ("Added login page", "wip dashboard", "bump deps"), so the
 * work breakdown isn't dominated by a useless "Other" bucket. Everything is
 * deterministic — the LLM handles the semantic "what shipped" narrative
 * separately; this only needs to be a good-enough tally, and it feeds Statistics
 * and the Analysis page too (which must never depend on an LLM).
 */
export function classifyCommit(message: string): CommitCategory {
  const subject = (message.split("\n")[0] ?? "").trim().toLowerCase();

  // Merge / integration commits are overhead, not authored work.
  if (/^merge\b|^merged\b|^merge (branch|pull request|remote|tag)/.test(subject)) {
    return "Chore";
  }

  // "type", "type(scope)", "type!:" conventional-commit forms.
  const prefix = subject.match(/^([a-z0-9]+)(\([^)]*\))?!?:/);
  if (prefix) {
    const mapped = PREFIX_MAP[prefix[1]!];
    if (mapped) {
      return mapped;
    }
  }

  // Keyword / imperative-verb fallback — MOST SPECIFIC FIRST so, e.g., "add tests"
  // is a Test not a Feature, and "update deps" is a Chore not a generic change.
  if (/\brevert(ed|s)?\b|\brollback\b|\broll back\b/.test(subject)) return "Fix";
  if (/\b(fix(e[ds])?|fixing|bug(s|fix)?|patch(e[ds])?|hotfix|crash(e[ds])?|regression|broke(n)?|error|issue|resolve[ds]?|correct(ed|s)?|repair)\b/.test(subject))
    return "Fix";
  if (/\b(perf|performance|optimi[sz]e[ds]?|optimi[sz]ation|speed ?up|faster|throughput|latency|memory leak)\b/.test(subject))
    return "Perf";
  if (/\b(test(s|ing|ed)?|spec(s)?|coverage|e2e|unit ?tests?|integration ?tests?)\b/.test(subject))
    return "Test";
  if (/\b(docs?|documentation|readme|changelog|comment(s|ed)?|jsdoc|javadoc)\b/.test(subject))
    return "Docs";
  if (/\b(ci|pipeline|workflow|release|deploy(ment|ed)?|docker|makefile|webpack|rollup|vite|bundl(e|ing))\b/.test(subject))
    return "Build";
  if (/\b(bump|upgrade[ds]?|downgrade|dependenc(y|ies)|deps?|package(s)?\.json|lockfile|chore|gitignore|\.env|scaffold)\b/.test(subject))
    return "Chore";
  if (/\b(refactor(ed|ing|s)?|clean ?up|cleaned|rename[ds]?|restructure[ds]?|reorganiz|extract(ed|s)?|split|simplif(y|ied)|dedup|tidy|lint(ed|ing)?|format(ted|ting)?|reformat|style)\b/.test(subject))
    return "Refactor";
  if (/\b(add(ed|s|ing)?|implement(ed|ing|s)?|introduc(e|ed|ing)|creat(e|ed|ing)|support(s|ed)?|enabl(e|ed|ing)|new|feature|integrat(e|ed|ing)|build ?out|wire ?up|hook(ed| )?up|connect(ed|s|ing)?)\b/.test(subject))
    return "Feature";
  if (/\b(remove[ds]?|removing|delete[ds]?|deleting|drop(ped|s)?|deprecat)\b/.test(subject)) return "Refactor";
  if (/\b(updat(e|ed|ing|es)|improv(e|ed|ing)|enhanc(e|ed|ing)|chang(e|ed|ing)|modif(y|ied)|adjust(ed|s)?|tweak(ed|s)?|revis(e|ed)|polish|refine|rework(ed|ing|s)?)\b/.test(subject))
    return "Refactor";

  return "Other";
}

const RISK_KEYWORDS = /\b(revert|hotfix|security|critical|urgent|breaking|vulnerab|cve)\b/i;

/** True when a commit subject hints at risk/urgency. */
export function hasRiskKeyword(message: string): boolean {
  return RISK_KEYWORDS.test(message.split("\n")[0] ?? "");
}

const SENSITIVE_PATH =
  /(^|\/)(auth|security|secret|\.env|migration|migrations|credential|password|token)/i;

/** True when a changed file lives in a security-sensitive area. */
export function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_PATH.test(filePath);
}

/** Top-level directory of a path, used as a coarse "module" bucket. */
export function moduleFromPath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts.length > 1 ? parts[0]! : "(root)";
}

const NOISE_PATH = new RegExp(
  [
    // Lockfiles — a dependency bump can add tens of thousands of lines.
    String.raw`(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|go\.sum)$`,
    // Generated / vendored directories.
    String.raw`(^|/)(node_modules|dist|build|out|\.next|vendor|coverage|__snapshots__)/`,
    // Minified bundles and build artifacts.
    String.raw`\.(min\.js|min\.css|map|snap)$`
  ].join("|")
);

/**
 * True for files whose line counts say nothing about human effort (lockfiles,
 * generated/vendored output, minified bundles). Analysis line counts exclude
 * these so a `npm install` commit can't inflate anyone's numbers.
 */
export function isNoisePath(filePath: string): boolean {
  return NOISE_PATH.test(filePath);
}
