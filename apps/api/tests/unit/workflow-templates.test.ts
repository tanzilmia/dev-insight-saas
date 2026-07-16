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
    expect(wf.templateVersion).toBe("2");
    expect(wf.content).toContain("# devinside-managed: node@v2");
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

  it("omits the code-quality job when no Sonar project key is given", () => {
    const wf = generateWorkflow(stack());
    expect(wf.content).not.toContain("code_quality:");
    expect(wf.content).not.toContain("sonarqube-scan-action");
  });

  it("emits a push-only SonarQube scan job when provisioned", () => {
    const wf = generateWorkflow(stack(), { sonarProjectKey: "devinside-acme-web" });
    expect(wf.content).toContain("code_quality:");
    // Community Edition scans main only → gated to push events, not PRs.
    expect(wf.content).toContain("if: github.event_name == 'push'");
    expect(wf.content).toContain("SonarSource/sonarqube-scan-action@");
    expect(wf.content).toContain("-Dsonar.projectKey=devinside-acme-web");
    // Full history for accurate SCM-blame author attribution.
    expect(wf.content).toContain("fetch-depth: 0");
    // Token + host come from injected repo secrets, never baked in.
    expect(wf.content).toContain("SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}");
    expect(wf.content).toContain("SONAR_HOST_URL: ${{ secrets.SONAR_HOST_URL }}");
  });

  it("treats a blank Sonar project key as not provisioned", () => {
    const wf = generateWorkflow(stack(), { sonarProjectKey: "   " });
    expect(wf.content).not.toContain("code_quality:");
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
      templateVersion: "2"
    });
  });
});
