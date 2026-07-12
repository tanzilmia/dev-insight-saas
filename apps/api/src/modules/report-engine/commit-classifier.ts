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
  refactor: "Refactor",
  docs: "Docs",
  doc: "Docs",
  test: "Test",
  tests: "Test",
  chore: "Chore",
  deps: "Chore",
  build: "Build",
  ci: "Build",
  perf: "Perf"
};

/** Classifies a commit by its subject line (conventional-commit prefix first). */
export function classifyCommit(message: string): CommitCategory {
  const subject = (message.split("\n")[0] ?? "").trim().toLowerCase();

  // "type", "type(scope)", "type!:" conventional-commit forms.
  const prefix = subject.match(/^([a-z]+)(\([^)]*\))?!?:/);
  if (prefix) {
    const mapped = PREFIX_MAP[prefix[1]!];
    if (mapped) {
      return mapped;
    }
  }

  if (/\b(fix|bug|patch)\b/.test(subject)) return "Fix";
  if (/\b(add|implement|introduce|feature|support)\b/.test(subject)) return "Feature";
  if (/\b(refactor|cleanup|rename|restructure)\b/.test(subject)) return "Refactor";
  if (/\bdoc(s|umentation)?\b/.test(subject)) return "Docs";
  if (/\btest(s|ing)?\b/.test(subject)) return "Test";
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
