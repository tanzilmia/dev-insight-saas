import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRepository: vi.fn(),
  updateRepository: vi.fn(),
  resolveRepositoryToken: vi.fn(),
  ingestPushedCommits: vi.fn(),
  ingestRepository: vi.fn(),
  contributorCount: vi.fn(),
  discoverContributors: vi.fn()
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    repository: {
      findUnique: mocks.findRepository,
      update: mocks.updateRepository
    },
    contributorIdentity: { count: mocks.contributorCount }
  }
}));

vi.mock("../../src/modules/github-app/repository-token.js", () => ({
  resolveRepositoryToken: mocks.resolveRepositoryToken
}));

vi.mock("../../src/modules/activity/activity.service.js", () => ({
  ingestPushedCommits: mocks.ingestPushedCommits,
  ingestRepository: mocks.ingestRepository
}));

vi.mock("../../src/modules/contributors/contributors.service.js", () => ({
  discoverContributorsForRepository: mocks.discoverContributors
}));

import { enqueuePushIngestion } from "../../src/modules/activity/push-ingestion.service.js";

describe("GitHub App push FIFO", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRepository.mockResolvedValue({
      id: "repo_1",
      owner: "softathena",
      name: "app",
      defaultBranch: "main"
    });
    mocks.resolveRepositoryToken.mockResolvedValue({ token: "ghs_token", provider: {} });
    mocks.updateRepository.mockResolvedValue({});
    mocks.contributorCount.mockResolvedValue(2);
  });

  it("processes rapid pushes in arrival order without replacing the first payload", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const seen: string[] = [];
    mocks.ingestPushedCommits.mockImplementation(async (_repo, _token, _provider, _branch, rows) => {
      seen.push(rows[0].sha);
      if (rows[0].sha === "sha_1") await firstPending;
    });

    enqueuePushIngestion("repo_fifo", {
      ref: "refs/heads/main",
      commits: [{ id: "sha_1", timestamp: "2026-07-17T00:00:00.000Z" }]
    });
    enqueuePushIngestion("repo_fifo", {
      ref: "refs/heads/feature",
      commits: [{ id: "sha_2", timestamp: "2026-07-17T00:01:00.000Z" }]
    });

    await vi.waitFor(() => expect(seen).toEqual(["sha_1"]));
    releaseFirst();
    await vi.waitFor(() => expect(seen).toEqual(["sha_1", "sha_2"]));
    await vi.waitFor(() => expect(mocks.updateRepository).toHaveBeenCalledTimes(2));

    expect(mocks.ingestPushedCommits.mock.calls[0]?.[3]).toBe("main");
    expect(mocks.ingestPushedCommits.mock.calls[1]?.[3]).toBe("feature");
  });
});
