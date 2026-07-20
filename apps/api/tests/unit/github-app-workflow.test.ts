import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInstallation: vi.fn(),
  findRepository: vi.fn(),
  resolveToken: vi.fn(),
  getProvider: vi.fn(),
  handleCompleted: vi.fn()
}));

vi.mock("../../src/config/env.js", () => ({
  env: { CI_AUTO_RETRY_ENABLED: true }
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    gitHubAppInstallation: { findFirst: mocks.findInstallation },
    repository: { findFirst: mocks.findRepository },
    ciConfiguration: { findUnique: vi.fn().mockResolvedValue({ status: "ENABLED" }) }
  }
}));

vi.mock("../../src/modules/github-app/repository-token.js", () => ({
  resolveRepositoryToken: mocks.resolveToken
}));

vi.mock("../../src/modules/devops-providers/devops-provider-registry.js", () => ({
  getDevOpsProvider: mocks.getProvider
}));

vi.mock("../../src/modules/ci/ci-retry.service.js", () => ({
  handleCompletedWorkflowRun: mocks.handleCompleted
}));

import { handleGitHubAppWorkflowRunEvent } from "../../src/modules/github-app/github-app-workflow.service.js";

describe("GitHub App workflow_run routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findInstallation.mockResolvedValue({ id: "inst_local", organizationId: "org_1" });
    mocks.findRepository.mockResolvedValue({
      id: "repo_local",
      organizationId: "org_1",
      provider: "GITHUB",
      owner: "acme",
      name: "web",
      defaultBranch: "main"
    });
    mocks.resolveToken.mockResolvedValue({ token: "installation-token" });
    mocks.getProvider.mockReturnValue({});
  });

  it("routes a completed workflow run to the retry service", async () => {
    await handleGitHubAppWorkflowRunEvent({
      action: "completed",
      installation: { id: 9001 },
      repository: { id: 7001 },
      workflow_run: {
        id: 99,
        workflow_id: 5,
        name: "CI",
        head_branch: "main",
        head_sha: "abc123",
        event: "push",
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/acme/web/actions/runs/99",
        run_started_at: "2026-07-20T10:00:00Z",
        updated_at: "2026-07-20T10:03:00Z"
      }
    });

    expect(mocks.handleCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ id: "repo_local" }),
      "installation-token",
      {},
      expect.objectContaining({ runId: "99", workflowId: "5", conclusion: "failure" })
    );
  });

  it("ignores non-completion workflow events", async () => {
    await handleGitHubAppWorkflowRunEvent({ action: "in_progress" });
    expect(mocks.findInstallation).not.toHaveBeenCalled();
    expect(mocks.handleCompleted).not.toHaveBeenCalled();
  });
});
