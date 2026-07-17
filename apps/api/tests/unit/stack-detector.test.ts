import { describe, expect, it } from "vitest";

import { detectStack, type InspectionFiles } from "../../src/modules/ci/stack-detector.js";

const noFiles: InspectionFiles = {
  packageJson: null,
  packageLock: null,
  pnpmLock: null,
  yarnLock: null,
  nvmrc: null
};

const pkg = (obj: unknown) => JSON.stringify(obj);

describe("detectStack", () => {
  it("detects a Node npm monorepo with all scripts and a framework", () => {
    const stack = detectStack({
      defaultBranch: "main",
      files: {
        ...noFiles,
        packageJson: pkg({
          workspaces: ["apps/*"],
          engines: { node: ">=20" },
          dependencies: { next: "16.0.0" },
          scripts: {
            lint: "eslint",
            typecheck: "tsc --noEmit",
            test: "vitest",
            build: "next build",
            "prisma:generate": "prisma generate",
            "test:coverage": "vitest run --coverage"
          }
        }),
        packageLock: "{}"
      }
    });
    expect(stack).toMatchObject({
      supported: true,
      runtime: "node",
      packageManager: "npm",
      isMonorepo: true,
      framework: "next",
      nodeVersion: "20",
      scripts: {
        lint: true,
        typecheck: true,
        test: true,
        build: true,
        prismaGenerate: true,
        testCoverage: true
      }
    });
  });

  it("detects the package manager from the lockfile", () => {
    const base = { defaultBranch: "main", files: { ...noFiles, packageJson: pkg({}) } };
    expect(detectStack({ ...base, files: { ...base.files, pnpmLock: "" } }).packageManager).toBe("pnpm");
    expect(detectStack({ ...base, files: { ...base.files, yarnLock: "" } }).packageManager).toBe("yarn");
    expect(detectStack(base).packageManager).toBe("npm");
  });

  it("reports unsupported when there is no package.json", () => {
    const stack = detectStack({ defaultBranch: "main", files: noFiles });
    expect(stack.supported).toBe(false);
    expect(stack.runtime).toBe("unknown");
    expect(stack.reason).toMatch(/No package.json/);
  });

  it("reports unsupported when package.json is malformed", () => {
    const stack = detectStack({
      defaultBranch: "main",
      files: { ...noFiles, packageJson: "{ not json" }
    });
    expect(stack.supported).toBe(false);
    expect(stack.reason).toMatch(/could not be parsed/);
  });

  it("only marks scripts that actually exist", () => {
    const stack = detectStack({
      defaultBranch: "main",
      files: { ...noFiles, packageJson: pkg({ scripts: { test: "vitest" } }) }
    });
    expect(stack.scripts).toEqual({
      lint: false,
      typecheck: false,
      test: true,
      build: false,
      prismaGenerate: false,
      testCoverage: false
    });
  });

  it("only detects the exact optional preparation script names", () => {
    const present = detectStack({
      defaultBranch: "main",
      files: {
        ...noFiles,
        packageJson: pkg({
          scripts: {
            "prisma:generate": "prisma generate",
            "test:coverage": "vitest run --coverage"
          }
        })
      }
    });
    expect(present.scripts.prismaGenerate).toBe(true);
    expect(present.scripts.testCoverage).toBe(true);

    const absent = detectStack({
      defaultBranch: "main",
      files: {
        ...noFiles,
        packageJson: pkg({ scripts: { prisma: "prisma generate", coverage: "vitest --coverage" } })
      }
    });
    expect(absent.scripts.prismaGenerate).toBe(false);
    expect(absent.scripts.testCoverage).toBe(false);
  });

  it("accepts the alternate 'type-check' script name", () => {
    const stack = detectStack({
      defaultBranch: "main",
      files: { ...noFiles, packageJson: pkg({ scripts: { "type-check": "tsc" } }) }
    });
    expect(stack.scripts.typecheck).toBe(true);
  });

  it("resolves the Node version from engines, then .nvmrc, then default 20", () => {
    expect(
      detectStack({
        defaultBranch: "main",
        files: { ...noFiles, packageJson: pkg({ engines: { node: "^18.0.0" } }) }
      }).nodeVersion
    ).toBe("18");
    expect(
      detectStack({
        defaultBranch: "main",
        files: { ...noFiles, packageJson: pkg({}), nvmrc: "v22.1.0" }
      }).nodeVersion
    ).toBe("22");
    expect(
      detectStack({ defaultBranch: "main", files: { ...noFiles, packageJson: pkg({}) } }).nodeVersion
    ).toBe("20");
  });

  it("detects express as the framework", () => {
    const stack = detectStack({
      defaultBranch: "main",
      files: { ...noFiles, packageJson: pkg({ dependencies: { express: "5" } }) }
    });
    expect(stack.framework).toBe("express");
  });
});
