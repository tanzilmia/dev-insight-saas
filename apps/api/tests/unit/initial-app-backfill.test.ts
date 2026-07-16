import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRepository: vi.fn(),
  findJob: vi.fn(),
  createJob: vi.fn(),
  createAudit: vi.fn()
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    repository: { findUnique: mocks.findRepository },
    collectionJob: { findFirst: mocks.findJob, create: mocks.createJob },
    auditLog: { create: mocks.createAudit }
  }
}));

import { ensureInitialAppBackfill } from "../../src/modules/activity/deep-collection.js";

describe("initial GitHub App backfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRepository.mockResolvedValue({
      id: "repo_1",
      organizationId: "org_1",
      appInstallationId: "inst_1"
    });
    mocks.findJob.mockResolvedValue(null);
    mocks.createJob.mockResolvedValue({ id: "job_1" });
    mocks.createAudit.mockResolvedValue({});
  });

  it("creates one persistent system-owned 90-day verify job", async () => {
    const before = Date.now();
    await expect(ensureInitialAppBackfill("repo_1")).resolves.toBe(true);
    const after = Date.now();

    const data = mocks.createJob.mock.calls[0]?.[0].data;
    expect(data).toMatchObject({
      organizationId: "org_1",
      repositoryId: "repo_1",
      requestedById: null,
      verify: true,
      currentPhase: "queued"
    });
    expect(data.rangeEnd.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.rangeEnd.getTime()).toBeLessThanOrEqual(after);
    expect(data.rangeEnd.getTime() - data.rangeStart.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("does not enqueue a duplicate onboarding job", async () => {
    mocks.findJob.mockResolvedValueOnce({ id: "existing_job" });

    await expect(ensureInitialAppBackfill("repo_1")).resolves.toBe(false);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
