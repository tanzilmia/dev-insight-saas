import type { CiRetryJob, Repository } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workflowUpsert: vi.fn(),
  retryFindUnique: vi.fn(),
  retryFindFirst: vi.fn(),
  retryCreate: vi.fn(),
  retryUpdate: vi.fn(),
  retryUpdateMany: vi.fn(),
  repositoryFindUnique: vi.fn(),
  repositoryFindMany: vi.fn(),
  configFindUnique: vi.fn(),
  listRuns: vi.fn(),
  listJobs: vi.fn(),
  getLog: vi.fn(),
  rerunFailed: vi.fn(),
  resolveToken: vi.fn(),
  getProvider: vi.fn()
}));

vi.mock("../../src/config/env.js", () => ({
  env: {
    CI_AUTO_RETRY_ENABLED: true,
    CI_AUTO_RETRY_QUEUE_INTERVAL_MS: 5000,
    CI_AUTO_RETRY_POLL_INTERVAL_MS: 120000,
    CI_AUTO_RETRY_MAX_REPOSITORIES_PER_POLL: 25
  }
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    workflowRun: { upsert: mocks.workflowUpsert },
    ciRetryJob: {
      findUnique: mocks.retryFindUnique,
      findFirst: mocks.retryFindFirst,
      create: mocks.retryCreate,
      update: mocks.retryUpdate,
      updateMany: mocks.retryUpdateMany
    },
    repository: {
      findUnique: mocks.repositoryFindUnique,
      findMany: mocks.repositoryFindMany
    },
    ciConfiguration: { findUnique: mocks.configFindUnique }
  }
}));

vi.mock("../../src/modules/github-app/repository-token.js", () => ({
  resolveRepositoryToken: mocks.resolveToken
}));

vi.mock("../../src/modules/devops-providers/devops-provider-registry.js", () => ({
  getDevOpsProvider: mocks.getProvider
}));

import {
  handleCompletedWorkflowRun,
  processNextRetryJob,
  reconcileRecentWorkflowRuns,
  startCiRetryWorker
} from "../../src/modules/ci/ci-retry.service.js";
import type {
  DevOpsProvider,
  WorkflowJobDto,
  WorkflowRunDto
} from "../../src/modules/devops-providers/devops-provider.js";

const repository = {
  id: "repo-1",
  organizationId: "org-1",
  provider: "GITHUB",
  owner: "acme",
  name: "web",
  defaultBranch: "main",
  updatedAt: new Date("2026-07-20T10:00:00Z")
} as unknown as Repository;

const failedRun = (overrides: Partial<WorkflowRunDto> = {}): WorkflowRunDto => ({
  runId: "run-1",
  workflowId: "workflow-1",
  name: "CI",
  branch: "main",
  headSha: "sha-1",
  event: "push",
  status: "completed",
  conclusion: "failure",
  actor: "tanzilmia",
  url: "https://github.com/acme/web/actions/runs/1",
  startedAt: "2026-07-20T10:00:00Z",
  completedAt: "2026-07-20T10:02:00Z",
  ...overrides
});

const sonarJob = (overrides: Partial<WorkflowJobDto> = {}): WorkflowJobDto => ({
  jobId: "job-1",
  runId: "run-1",
  name: "code_quality",
  status: "completed",
  conclusion: "failure",
  steps: [{ name: "SonarQube Scan", status: "completed", conclusion: "failure" }],
  ...overrides
});

function retryJob(overrides: Partial<CiRetryJob> = {}): CiRetryJob {
  return {
    id: "retry-1",
    organizationId: "org-1",
    repositoryId: "repo-1",
    sourceRunId: "run-1",
    latestRunId: "run-1",
    workflowId: "workflow-1",
    workflowName: "CI",
    headSha: "sha-1",
    branch: "main",
    status: "PENDING",
    attempts: 0,
    maxAttempts: 2,
    reason: "transient-infrastructure",
    diagnostic: "REFUSED_STREAM",
    nextAttemptAt: new Date("2026-07-20T10:00:00Z"),
    lockedUntil: null,
    lastError: null,
    createdAt: new Date("2026-07-20T10:00:00Z"),
    updatedAt: new Date("2026-07-20T10:00:00Z"),
    ...overrides
  };
}

describe("CI retry service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workflowUpsert.mockResolvedValue({});
    mocks.retryFindUnique.mockResolvedValue(null);
    mocks.retryFindFirst.mockResolvedValue(null);
    mocks.retryCreate.mockResolvedValue({});
    mocks.retryUpdate.mockResolvedValue({});
    mocks.retryUpdateMany.mockResolvedValue({ count: 0 });
    mocks.repositoryFindUnique.mockResolvedValue(repository);
    mocks.repositoryFindMany.mockResolvedValue([]);
    mocks.configFindUnique.mockResolvedValue({ status: "ENABLED" });
    mocks.resolveToken.mockResolvedValue({ token: "installation-token" });
    mocks.listRuns.mockResolvedValue([]);
    mocks.listJobs.mockResolvedValue([sonarJob()]);
    mocks.getLog.mockResolvedValue("REFUSED_STREAM");
    mocks.rerunFailed.mockResolvedValue(undefined);
    mocks.getProvider.mockReturnValue({
      listWorkflowRuns: mocks.listRuns,
      listWorkflowJobs: mocks.listJobs,
      getWorkflowJobLog: mocks.getLog,
      rerunFailedJobs: mocks.rerunFailed
    } satisfies Partial<DevOpsProvider>);
  });

  it("queues a failed push run when the failure is transient", async () => {
    await handleCompletedWorkflowRun(repository, "token", mocks.getProvider(), failedRun());

    expect(mocks.workflowUpsert).toHaveBeenCalledOnce();
    expect(mocks.retryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceRunId: "run-1",
          status: "PENDING",
          reason: "transient-infrastructure"
        })
      })
    );
  });

  it("does not enqueue the same failed source run twice", async () => {
    mocks.retryFindUnique.mockResolvedValue(retryJob());

    await handleCompletedWorkflowRun(repository, "token", mocks.getProvider(), failedRun());

    expect(mocks.listJobs).not.toHaveBeenCalled();
    expect(mocks.retryCreate).not.toHaveBeenCalled();
  });

  it("marks a triggered retry successful when its rerun completes", async () => {
    mocks.retryFindUnique.mockResolvedValue(retryJob({ status: "TRIGGERED" }));

    await handleCompletedWorkflowRun(
      repository,
      "token",
      mocks.getProvider(),
      failedRun({ runId: "run-2", conclusion: "success" })
    );

    expect(mocks.retryUpdate).toHaveBeenCalledWith({
      where: { id: "retry-1" },
      data: { latestRunId: "run-2", status: "SUCCEEDED", lockedUntil: null }
    });
  });

  it("requeues a triggered retry when the rerun fails transiently", async () => {
    mocks.retryFindFirst.mockResolvedValue(retryJob({ status: "TRIGGERED" }));

    await handleCompletedWorkflowRun(
      repository,
      "token",
      mocks.getProvider(),
      failedRun({ runId: "run-2" })
    );

    expect(mocks.retryUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "retry-1" },
        data: expect.objectContaining({ latestRunId: "run-2", status: "PENDING" })
      })
    );
  });

  it("skips a rerun that failed its SonarQube quality gate", async () => {
    mocks.retryFindFirst.mockResolvedValue(retryJob({ status: "TRIGGERED" }));
    mocks.getLog.mockResolvedValue("QUALITY GATE STATUS: FAILED");

    await handleCompletedWorkflowRun(
      repository,
      "token",
      mocks.getProvider(),
      failedRun({ runId: "run-2" })
    );

    expect(mocks.retryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "retry-1" },
        data: expect.objectContaining({ status: "SKIPPED", latestRunId: "run-2" })
      })
    );
  });

  it("claims a queued job and triggers GitHub failed-job rerun", async () => {
    const job = retryJob();
    mocks.retryFindFirst.mockResolvedValue(job);
    mocks.retryUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.retryFindUnique.mockResolvedValue(job);

    await expect(processNextRetryJob()).resolves.toBe(true);

    expect(mocks.rerunFailed).toHaveBeenCalledWith("installation-token", {
      owner: "acme",
      repo: "web"
    }, "run-1");
    expect(mocks.retryUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "retry-1" },
        data: expect.objectContaining({ status: "TRIGGERED" })
      })
    );
  });

  it("exhausts a job when the retry request fails on its last attempt", async () => {
    const job = retryJob({ attempts: 1 });
    mocks.retryFindFirst.mockResolvedValue(job);
    mocks.retryUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.retryFindUnique.mockResolvedValue(job);
    mocks.rerunFailed.mockRejectedValue(new Error("Actions write permission missing"));

    await expect(processNextRetryJob()).resolves.toBe(true);

    expect(mocks.retryUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: "retry-1" },
        data: expect.objectContaining({
          status: "EXHAUSTED",
          lastError: "Actions write permission missing"
        })
      })
    );
  });

  it("skips a queued job when CI has been disabled", async () => {
    const job = retryJob();
    mocks.retryFindFirst.mockResolvedValue(job);
    mocks.retryUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.retryFindUnique.mockResolvedValue(job);
    mocks.configFindUnique.mockResolvedValue({ status: "DISABLED" });

    await expect(processNextRetryJob()).resolves.toBe(true);

    expect(mocks.rerunFailed).not.toHaveBeenCalled();
    expect(mocks.retryUpdate).toHaveBeenCalledWith({
      where: { id: "retry-1" },
      data: { status: "SKIPPED", lockedUntil: null, diagnostic: "CI is not enabled" }
    });
  });

  it("reconciles recent default-branch runs when a webhook was missed", async () => {
    mocks.repositoryFindMany.mockResolvedValue([repository]);
    mocks.listRuns.mockResolvedValue([failedRun()]);

    await reconcileRecentWorkflowRuns();

    expect(mocks.listRuns).toHaveBeenCalledWith(
      "installation-token",
      { owner: "acme", repo: "web" },
      { perPage: 5, branch: "main" }
    );
    expect(mocks.retryCreate).toHaveBeenCalledOnce();
  });

  it("starts the queue and reconciliation loops only once", async () => {
    vi.useFakeTimers();

    startCiRetryWorker();
    await vi.advanceTimersByTimeAsync(0);
    startCiRetryWorker();

    expect(mocks.retryFindFirst).toHaveBeenCalled();
    expect(mocks.repositoryFindMany).toHaveBeenCalled();

    vi.useRealTimers();
  });
});
