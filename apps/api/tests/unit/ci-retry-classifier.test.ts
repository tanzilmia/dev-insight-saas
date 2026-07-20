import { describe, expect, it } from "vitest";

import { classifyWorkflowFailure } from "../../src/modules/ci/ci-retry-classifier.js";
import type { WorkflowJobDto } from "../../src/modules/devops-providers/devops-provider.js";

function job(overrides: Partial<WorkflowJobDto> = {}): WorkflowJobDto {
  return {
    jobId: "job-1",
    runId: "run-1",
    name: "code_quality",
    status: "completed",
    conclusion: "failure",
    steps: [{ name: "SonarQube Scan", status: "completed", conclusion: "failure" }],
    ...overrides
  };
}

describe("classifyWorkflowFailure", () => {
  it("retries a SonarQube HTTP/2 stream reset", () => {
    const result = classifyWorkflowFailure([job()], new Map([["job-1", "REFUSED_STREAM"]]));
    expect(result).toMatchObject({ retryable: true, reason: "transient-infrastructure" });
  });

  it("retries a temporary gateway failure", () => {
    const result = classifyWorkflowFailure([job()], new Map([["job-1", "HTTP 503"]]));
    expect(result.retryable).toBe(true);
  });

  it("does not retry a failed repository verification job", () => {
    const result = classifyWorkflowFailure(
      [job({ name: "verify", steps: [{ name: "Test", status: "completed", conclusion: "failure" }] })],
      new Map([["job-1", "AssertionError"]])
    );
    expect(result).toMatchObject({ retryable: false, reason: "repository-check-failed" });
  });

  it("does not retry a quality-gate failure", () => {
    const result = classifyWorkflowFailure(
      [job()],
      new Map([["job-1", "Quality Gate failed because new code has issues"]])
    );
    expect(result).toMatchObject({ retryable: false, reason: "code-quality-or-configuration-failed" });
  });

  it("does not retry an unknown failure", () => {
    const result = classifyWorkflowFailure([job()], new Map([["job-1", "unexpected failure"]]));
    expect(result).toMatchObject({ retryable: false, reason: "unknown-failure" });
  });
});
