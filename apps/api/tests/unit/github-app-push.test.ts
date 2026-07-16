import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInstallation: vi.fn(),
  findRepository: vi.fn(),
  ensureBackfill: vi.fn(),
  enqueue: vi.fn()
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    gitHubAppInstallation: { findFirst: mocks.findInstallation },
    repository: { findFirst: mocks.findRepository }
  }
}));

vi.mock("../../src/modules/activity/deep-collection.js", () => ({
  ensureInitialAppBackfill: mocks.ensureBackfill
}));

vi.mock("../../src/modules/activity/push-ingestion.service.js", () => ({
  enqueuePushIngestion: mocks.enqueue
}));

import { handleGitHubAppPushEvent } from "../../src/modules/github-app/github-app-push.service.js";

describe("GitHub App push tenant routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findInstallation.mockResolvedValue({ id: "inst_local", organizationId: "org_1" });
    mocks.findRepository.mockResolvedValue({ id: "repo_local" });
    mocks.ensureBackfill.mockResolvedValue(false);
  });

  it("requires installation, tenant, external repo, App link, and access grant to agree", async () => {
    const payload = {
      installation: { id: 9001 },
      repository: { id: 7001, full_name: "softathena/app" },
      ref: "refs/heads/main",
      commits: [{ id: "abc" }]
    };

    await handleGitHubAppPushEvent(payload);

    expect(mocks.findInstallation).toHaveBeenCalledWith({
      where: { installationId: "9001", suspendedAt: null },
      select: { id: true, organizationId: true }
    });
    expect(mocks.findRepository).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        provider: "GITHUB",
        externalId: "7001",
        appInstallationId: "inst_local",
        access: { some: { appInstallationId: "inst_local" } }
      },
      select: { id: true }
    });
    expect(mocks.ensureBackfill).toHaveBeenCalledWith("repo_local");
    expect(mocks.enqueue).toHaveBeenCalledWith("repo_local", payload);
  });

  it("ignores an unknown or removed repository", async () => {
    mocks.findRepository.mockResolvedValue(null);

    await handleGitHubAppPushEvent({
      installation: { id: 9001 },
      repository: { id: 9999 },
      ref: "refs/heads/main"
    });

    expect(mocks.ensureBackfill).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
