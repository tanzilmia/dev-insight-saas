import type { WorkflowJobDto } from "../devops-providers/devops-provider.js";

export type RetryClassification = {
  retryable: boolean;
  reason: string;
  diagnostic: string;
};

const TRANSIENT_SIGNATURES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /refused_stream/i, label: "HTTP/2 stream reset" },
  { pattern: /connection reset|econnreset|socket hang up/i, label: "connection reset" },
  { pattern: /etimedout|timed out|timeout/i, label: "network timeout" },
  { pattern: /502|503|504|bad gateway|service unavailable|gateway timeout/i, label: "temporary gateway error" },
  { pattern: /runner (unavailable|failure)|startup failure|failed to start runner/i, label: "runner startup failure" },
  { pattern: /temporary failure in name resolution|could not resolve host|dns/i, label: "temporary DNS failure" }
];

const TERMINAL_SIGNATURES = [
  /quality.?gate.*(fail|not pass)/i,
  /authentication|unauthorized|forbidden|permission denied|missing.*secret/i,
  /invalid.*(project|key|token)/i,
  /assertion|syntax error|type error|compilation failed/i
];

const CODE_JOB_NAMES = new Set(["code_quality", "code quality", "sonarqube scan"]);

function isCodeQualityJob(name: string | null): boolean {
  const normalized = name?.trim().toLowerCase() ?? "";
  return CODE_JOB_NAMES.has(normalized) || normalized.includes("code_quality");
}

/**
 * Conservative classifier for automatic retries. It intentionally returns
 * false when a failure cannot be attributed to a known infrastructure symptom.
 */
export function classifyWorkflowFailure(
  jobs: WorkflowJobDto[],
  logsByJobId: ReadonlyMap<string, string>
): RetryClassification {
  const failedJobs = jobs.filter((job) => job.conclusion && job.conclusion !== "success");
  if (!failedJobs.length) {
    return { retryable: false, reason: "no-failed-job", diagnostic: "No failed job details" };
  }

  const nonCodeFailure = failedJobs.find((job) => !isCodeQualityJob(job.name));
  if (nonCodeFailure) {
    return {
      retryable: false,
      reason: "repository-check-failed",
      diagnostic: `${nonCodeFailure.name ?? "workflow job"} failed`
    };
  }

  const evidence = failedJobs
    .flatMap((job) => [
      job.conclusion ?? "",
      ...job.steps.map((step) => `${step.name} ${step.conclusion ?? ""}`),
      logsByJobId.get(job.jobId) ?? ""
    ])
    .join("\n");

  const failedRepositoryStep = failedJobs
    .flatMap((job) => job.steps)
    .find(
      (step) =>
        step.conclusion &&
        step.conclusion !== "success" &&
        /lint|type.?check|test|build/i.test(step.name)
    );
  if (failedRepositoryStep) {
    return {
      retryable: false,
      reason: "repository-check-failed",
      diagnostic: `${failedRepositoryStep.name} failed`
    };
  }

  if (TERMINAL_SIGNATURES.some((pattern) => pattern.test(evidence))) {
    return {
      retryable: false,
      reason: "code-quality-or-configuration-failed",
      diagnostic: "SonarQube or repository configuration failure"
    };
  }

  const transient = TRANSIENT_SIGNATURES.find(({ pattern }) => pattern.test(evidence));
  if (!transient) {
    return {
      retryable: false,
      reason: "unknown-failure",
      diagnostic: "Failure did not match a known transient signature"
    };
  }

  return { retryable: true, reason: "transient-infrastructure", diagnostic: transient.label };
}
