import { describe, expect, it } from "vitest";

import type { DetectedStack } from "../../src/modules/ci/stack-detector.js";
import {
  MANAGED_WORKFLOW_PATH,
  generateWorkflow,
  parseManagedMarker
} from "../../src/modules/ci/workflow-templates.js";

const stack = (over: Partial<DetectedStack> = {}): DetectedStack => ({
  supported: true,
  runtime: "node",
  defaultBranch: "main",
  packageManager: "npm",
  isMonorepo: false,
  framework: null,
  nodeVersion: "20",
  scripts: { lint: true, typecheck: true, test: true, build: true },
  reason: null,
  ...over
});

describe("generateWorkflow", () => {
  it("produces a marked, deterministic workflow at the managed path", () => {
    const wf = generateWorkflow(stack());
    expect(wf.path).toBe(MANAGED_WORKFLOW_PATH);
    expect(wf.templateId).toBe("node");
    expect(wf.templateVersion).toBe("1");
    expect(wf.content).toContain("# devinside-managed: node@v1");
    expect(wf.content).toContain("name: CI");
    expect(wf.content).toContain("workflow_dispatch:");
    expect(wf.content).toContain("pull_request:");
    expect(wf.content).toContain('branches: ["main"]');
    expect(wf.content).toContain("permissions:\n  contents: read");
    expect(wf.content).toContain("actions/checkout@v4");
    expect(wf.content).toContain("actions/setup-node@v4");
    expect(wf.content).toContain('node-version: "20"');
    expect(wf.content).toContain('cache: "npm"');
    expect(wf.content).toContain("run: npm ci");
  });

  it("emits only the steps whose scripts exist", () => {
    const wf = generateWorkflow(stack({ scripts: { lint: false, typecheck: false, test: true, build: false } }));
    expect(wf.content).toContain("run: npm run test");
    expect(wf.content).not.toContain("run: npm run lint");
    expect(wf.content).not.toContain("run: npm run typecheck");
    expect(wf.content).not.toContain("run: npm run build");
  });

  it("uses pnpm setup + install when pnpm is the package manager", () => {
    const wf = generateWorkflow(stack({ packageManager: "pnpm" }));
    expect(wf.content).toContain("pnpm/action-setup@v4");
    expect(wf.content).toContain('cache: "pnpm"');
    expect(wf.content).toContain("run: pnpm install --frozen-lockfile");
    expect(wf.content).toContain("run: pnpm run lint");
  });

  it("uses yarn install for yarn", () => {
    const wf = generateWorkflow(stack({ packageManager: "yarn" }));
    expect(wf.content).toContain("run: yarn install --frozen-lockfile");
    expect(wf.content).not.toContain("pnpm/action-setup");
  });

  it("honors the detected default branch", () => {
    expect(generateWorkflow(stack({ defaultBranch: "develop" })).content).toContain(
      'branches: ["develop"]'
    );
  });

  it("throws (never fakes) for an unsupported stack", () => {
    expect(() =>
      generateWorkflow(stack({ supported: false, reason: "No package.json found." }))
    ).toThrow(/No package.json found/);
  });
});

describe("parseManagedMarker", () => {
  it("parses the managed marker", () => {
    expect(parseManagedMarker("# devinside-managed: node@v1\nname: CI")).toEqual({
      templateId: "node",
      templateVersion: "1"
    });
  });

  it("returns null for a non-managed file", () => {
    expect(parseManagedMarker("name: CI\non: push")).toBeNull();
  });

  it("round-trips its own generated output", () => {
    expect(parseManagedMarker(generateWorkflow(stack()).content)).toEqual({
      templateId: "node",
      templateVersion: "1"
    });
  });
});
