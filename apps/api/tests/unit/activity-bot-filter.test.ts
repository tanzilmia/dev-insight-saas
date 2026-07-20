import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  branchUpsert: vi.fn(),
  commitFindMany: vi.fn(),
  commitCreate: vi.fn(),
  changedFileCreateMany: vi.fn(),
  commitBranchCreateMany: vi.fn(),
  transaction: vi.fn(),
  listCommits: vi.fn(),
  getCommitDetail: vi.fn(),
  coverageFindMany: vi.fn(),
  coverageDeleteMany: vi.fn(),
  coverageCreate: vi.fn(),
  commitCount: vi.fn()
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    branch: { upsert: mocks.branchUpsert },
    commit: { findMany: mocks.commitFindMany, count: mocks.commitCount },
    commitBranch: { createMany: mocks.commitBranchCreateMany },
    $transaction: mocks.transaction
  }
}));

import {
  ingestBranchRange,
  ingestPushedCommits
} from "../../src/modules/activity/activity.service.js";

const repository = {
  id: "repo_1",
  owner: "acme",
  name: "app",
  fullName: "acme/app",
  defaultBranch: "main"
} as never;

function makeCommit(sha: string, username: string | null) {
  return {
    sha,
    message: `${sha} message`,
    committedAt: "2026-07-20T00:00:00.000Z",
    authorName: username,
    authorEmail: `${sha}@example.com`,
    username
  };
}

describe("activity bot filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.branchUpsert.mockResolvedValue({ id: "branch_1" });
    mocks.commitFindMany.mockResolvedValue([]);
    mocks.commitCreate.mockImplementation(async (args) => ({ id: `stored_${args.data.sha}` }));
    mocks.changedFileCreateMany.mockResolvedValue({});
    mocks.commitBranchCreateMany.mockResolvedValue({});
    mocks.coverageFindMany.mockResolvedValue([]);
    mocks.coverageDeleteMany.mockResolvedValue({});
    mocks.coverageCreate.mockResolvedValue({});
    mocks.commitCount.mockResolvedValue(1);
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        commit: { create: mocks.commitCreate, count: mocks.commitCount },
        changedFile: { createMany: mocks.changedFileCreateMany },
        repositoryCoverage: {
          findMany: mocks.coverageFindMany,
          deleteMany: mocks.coverageDeleteMany,
          create: mocks.coverageCreate
        }
      })
    );
    mocks.getCommitDetail.mockResolvedValue({
      additions: 2,
      deletions: 1,
      changedFilesCount: 1,
      files: []
    });
  });

  it("stores and links human commits but never details bot commits from a push", async () => {
    const provider = {
      getCommitDetail: mocks.getCommitDetail
    } as never;
    const commits = [makeCommit("human_sha", "alice"), makeCommit("bot_sha", "github-actions[bot]")];

    const result = await ingestPushedCommits(repository, "token", provider, "main", commits);

    expect(result).toEqual({ newCollected: 1 });
    expect(mocks.getCommitDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getCommitDetail).toHaveBeenCalledWith("token", "acme", "app", "human_sha");
    expect(mocks.commitCreate).toHaveBeenCalledTimes(1);
    expect(mocks.commitCreate.mock.calls[0]?.[0].data.username).toBe("alice");
    expect(mocks.commitBranchCreateMany).toHaveBeenCalledWith({
      data: [{ commitId: "stored_human_sha", branchId: "branch_1" }],
      skipDuplicates: true
    });
  });

  it("filters bots from list-based backfill before detail collection", async () => {
    const provider = {
      listCommits: mocks.listCommits,
      getCommitDetail: mocks.getCommitDetail
    } as never;
    mocks.listCommits.mockResolvedValue([
      makeCommit("human_sha", "alice"),
      makeCommit("bot_sha", "dependabot")
    ]);
    const branch = { id: "branch_1", name: "main" } as never;

    const result = await ingestBranchRange(
      repository,
      branch,
      "token",
      provider,
      new Date("2026-07-19T00:00:00.000Z"),
      new Date("2026-07-21T00:00:00.000Z")
    );

    expect(result).toEqual({ newCollected: 1, detailCapped: false, cancelled: false });
    expect(mocks.getCommitDetail).toHaveBeenCalledTimes(1);
    expect(mocks.getCommitDetail).toHaveBeenCalledWith("token", "acme", "app", "human_sha");
    expect(mocks.commitCreate).toHaveBeenCalledTimes(1);
    expect(mocks.commitBranchCreateMany).toHaveBeenCalledWith({
      data: [{ commitId: "stored_human_sha", branchId: "branch_1" }],
      skipDuplicates: true
    });
  });

  it("keeps branch metadata for a bot-only push without storing activity", async () => {
    const provider = { getCommitDetail: mocks.getCommitDetail } as never;
    const commits = [makeCommit("bot_sha", "github-actions[bot]")];

    const result = await ingestPushedCommits(repository, "token", provider, "main", commits);

    expect(result).toEqual({ newCollected: 0 });
    expect(mocks.branchUpsert).toHaveBeenCalledWith({
      where: { repositoryId_name: { repositoryId: "repo_1", name: "main" } },
      create: {
        repositoryId: "repo_1",
        name: "main",
        isDefault: true,
        headSha: "bot_sha",
        isProtected: false
      },
      update: { headSha: "bot_sha", lastSyncedAt: expect.any(Date) }
    });
    expect(mocks.getCommitDetail).not.toHaveBeenCalled();
    expect(mocks.commitCreate).not.toHaveBeenCalled();
    expect(mocks.commitBranchCreateMany).not.toHaveBeenCalled();
  });
});
