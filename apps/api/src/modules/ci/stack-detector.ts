/**
 * Deterministic repository stack detection. Pure (no IO) so it is trivially
 * testable: given the repository's root files, it reports the runtime, package
 * manager, monorepo/framework, Node version, and WHICH scripts actually exist.
 * The workflow generator only ever emits steps for detected scripts — commands
 * are never invented. Only Node.js is supported in this MVP; other stacks are
 * reported as unsupported (never faked).
 */

export type PackageManager = "npm" | "pnpm" | "yarn";

export type DetectedScripts = {
  lint: boolean;
  typecheck: boolean;
  test: boolean;
  build: boolean;
  prismaGenerate: boolean;
  testCoverage: boolean;
};

export type DetectedStack = {
  supported: boolean;
  runtime: "node" | "unknown";
  defaultBranch: string;
  packageManager: PackageManager;
  isMonorepo: boolean;
  framework: string | null; // "next" | "express" | null
  nodeVersion: string; // major version, e.g. "20"
  scripts: DetectedScripts;
  reason: string | null; // set when unsupported
};

export type InspectionFiles = {
  packageJson: string | null;
  packageLock: string | null;
  pnpmLock: string | null;
  yarnLock: string | null;
  nvmrc: string | null;
};

export type InspectionInput = {
  defaultBranch: string;
  files: InspectionFiles;
};

const DEFAULT_NODE_VERSION = "20";

/** Extracts a major Node version from an engines/nvmrc value; null if none. */
function parseNodeMajor(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/(\d+)/);
  return match ? match[1]! : null;
}

function unsupported(defaultBranch: string, reason: string): DetectedStack {
  return {
    supported: false,
    runtime: "unknown",
    defaultBranch,
    packageManager: "npm",
    isMonorepo: false,
    framework: null,
    nodeVersion: DEFAULT_NODE_VERSION,
    scripts: {
      lint: false,
      typecheck: false,
      test: false,
      build: false,
      prismaGenerate: false,
      testCoverage: false
    },
    reason
  };
}

export function detectStack(input: InspectionInput): DetectedStack {
  const { files, defaultBranch } = input;

  if (!files.packageJson) {
    return unsupported(
      defaultBranch,
      "No package.json was found at the repository root. Only Node.js projects are supported for now."
    );
  }

  let pkg: {
    scripts?: Record<string, unknown>;
    workspaces?: unknown;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    engines?: { node?: string };
  };
  try {
    pkg = JSON.parse(files.packageJson);
  } catch {
    return unsupported(defaultBranch, "The repository's package.json could not be parsed.");
  }

  // Presence is "the file exists" (non-null), not "has content".
  const packageManager: PackageManager =
    files.pnpmLock !== null ? "pnpm" : files.yarnLock !== null ? "yarn" : "npm";

  const isMonorepo = Array.isArray(pkg.workspaces) || typeof pkg.workspaces === "object";

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const framework = "next" in deps ? "next" : "express" in deps ? "express" : null;

  const nodeVersion =
    parseNodeMajor(pkg.engines?.node) ?? parseNodeMajor(files.nvmrc) ?? DEFAULT_NODE_VERSION;

  const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
  const has = (name: string) => typeof scripts[name] === "string" && scripts[name] !== "";

  return {
    supported: true,
    runtime: "node",
    defaultBranch,
    packageManager,
    isMonorepo,
    framework,
    nodeVersion,
    scripts: {
      lint: has("lint"),
      typecheck: has("typecheck") || has("type-check"),
      test: has("test"),
      build: has("build"),
      prismaGenerate: has("prisma:generate"),
      testCoverage: has("test:coverage")
    },
    reason: null
  };
}
