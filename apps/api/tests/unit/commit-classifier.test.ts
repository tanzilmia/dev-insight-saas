import { describe, expect, it } from "vitest";

import {
  classifyCommit,
  hasRiskKeyword,
  isNoisePath,
  isSensitivePath,
  moduleFromPath
} from "../../src/modules/report-engine/commit-classifier.js";

describe("classifyCommit", () => {
  it("maps conventional-commit prefixes", () => {
    expect(classifyCommit("feat: add login")).toBe("Feature");
    expect(classifyCommit("fix(auth): handle null")).toBe("Fix");
    expect(classifyCommit("chore!: bump deps")).toBe("Chore");
    expect(classifyCommit("docs: update readme")).toBe("Docs");
    expect(classifyCommit("perf: speed up query")).toBe("Perf");
    expect(classifyCommit("test: add specs")).toBe("Test");
    expect(classifyCommit("refactor: extract helper")).toBe("Refactor");
    expect(classifyCommit("ci: add workflow")).toBe("Build");
  });

  it("treats merge commits as Chore (integration overhead)", () => {
    expect(classifyCommit("Merge branch 'main' into dev")).toBe("Chore");
    expect(classifyCommit("Merge pull request #42 from x/y")).toBe("Chore");
  });

  it("falls back to keywords for messy real-world messages, most-specific first", () => {
    expect(classifyCommit("Added login page")).toBe("Feature");
    expect(classifyCommit("add tests for parser")).toBe("Test"); // Test beats Feature
    expect(classifyCommit("update deps")).toBe("Chore"); // Chore beats generic update
    expect(classifyCommit("optimize the render loop")).toBe("Perf");
    expect(classifyCommit("rename the module")).toBe("Refactor");
    expect(classifyCommit("revert bad change")).toBe("Fix");
    expect(classifyCommit("fixed a crash on startup")).toBe("Fix");
    expect(classifyCommit("tweak the layout")).toBe("Refactor"); // generic update verb -> Refactor
  });

  it("lets a Fix keyword win over a generic verb (e.g. 'error' -> Fix)", () => {
    // "improve" is a generic-update verb, but "error" is a Fix signal and wins.
    expect(classifyCommit("improve error handling")).toBe("Fix");
  });

  it("returns Other only for genuinely meaningless messages", () => {
    expect(classifyCommit("misc")).toBe("Other");
    expect(classifyCommit("asdf")).toBe("Other");
    expect(classifyCommit("stuff")).toBe("Other");
  });

  it("classifies on the first subject line only", () => {
    expect(classifyCommit("fix: null guard\n\nlong body mentioning a new feature")).toBe("Fix");
  });
});

describe("hasRiskKeyword", () => {
  it("flags risky / urgent subjects", () => {
    expect(hasRiskKeyword("hotfix: patch security hole")).toBe(true);
    expect(hasRiskKeyword("BREAKING change to the api")).toBe(true);
    expect(hasRiskKeyword("fix CVE-2024-1234")).toBe(true);
  });

  it("is false for ordinary subjects", () => {
    expect(hasRiskKeyword("add a button")).toBe(false);
  });
});

describe("isSensitivePath", () => {
  it("detects security-sensitive files", () => {
    expect(isSensitivePath("src/auth/login.ts")).toBe(true);
    expect(isSensitivePath("apps/api/.env")).toBe(true);
    expect(isSensitivePath("prisma/migrations/x.sql")).toBe(true);
    expect(isSensitivePath("config/credential.ts")).toBe(true);
  });

  it("is false for ordinary files", () => {
    expect(isSensitivePath("src/components/button.tsx")).toBe(false);
  });
});

describe("moduleFromPath", () => {
  it("returns the top-level directory", () => {
    expect(moduleFromPath("src/modules/auth/x.ts")).toBe("src");
  });

  it("returns (root) for a top-level file", () => {
    expect(moduleFromPath("README.md")).toBe("(root)");
  });
});

describe("isNoisePath", () => {
  it("flags lockfiles, generated dirs and minified artifacts", () => {
    expect(isNoisePath("package-lock.json")).toBe(true);
    expect(isNoisePath("apps/web/pnpm-lock.yaml")).toBe(true);
    expect(isNoisePath("node_modules/react/index.js")).toBe(true);
    expect(isNoisePath("dist/bundle.js")).toBe(true);
    expect(isNoisePath("public/app.min.js")).toBe(true);
    expect(isNoisePath("src/__snapshots__/x.snap")).toBe(true);
  });

  it("is false for real source files", () => {
    expect(isNoisePath("src/lib/api.ts")).toBe(false);
    expect(isNoisePath("apps/api/src/index.ts")).toBe(false);
  });
});
