# GitHub Actions Automatic Failure Retry — Design Specification

**Date:** 2026-07-20  
**Status:** Design approved for specification review; implementation not started

## Problem

DevInsight-managed GitHub Actions workflows can fail because of transient infrastructure problems such as a SonarQube connection reset, runner startup failure, timeout, or a temporary 502/503/504 response. Today the customer must open GitHub Actions and manually choose **Re-run failed jobs**.

The product should retry only transient failures automatically. It must not hide real repository failures such as lint, typecheck, test, build, or SonarQube quality-gate failures.

## Goals

- Detect completed failures for tracked, CI-enabled repositories without a customer action.
- Classify failures conservatively as retryable or non-retryable.
- Trigger GitHub's failed-jobs rerun endpoint from the DevInsight backend.
- Retry at most twice with durable exponential backoff.
- Survive API/container restarts and concurrent webhook deliveries.
- Keep GitHub App authentication and repository permissions scoped to the existing installation.
- Show retry state and the final outcome in DevInsight's CI history.

## Non-goals

- Retrying lint, typecheck, test, build, or quality-gate failures.
- Automatically changing customer workflow files.
- Retrying cancelled workflows or workflows deliberately stopped by a user.
- Building a general-purpose job queue for unrelated DevInsight tasks.
- Replacing the existing read-only workflow-run history synchronization.

## Chosen architecture

Use a GitHub App `workflow_run` webhook as the primary trigger, a PostgreSQL-backed retry queue for durable state, and a separate worker process for execution. A low-frequency polling reconciliation loop remains as a fallback for missed webhook deliveries.

```text
GitHub workflow completed
          |
          v
  signed workflow_run webhook
          |
          v
  verify + persist WorkflowRun
          |
          v
  inspect failed jobs/logs
          |
   retryable? ---- no ----> terminal failure
       |
      yes
       v
  CiRetryJob (PostgreSQL)
       |
       v
  retry worker claims job
       |
       v
  GitHub rerun-failed-jobs API
       |
       v
  new workflow_run event -> reconcile outcome
```

### Why this architecture

- A webhook avoids polling every repository for every run.
- PostgreSQL makes retries durable without introducing Redis for a focused feature.
- A separate worker keeps webhook handling fast and prevents customer API requests from waiting on GitHub.
- `FOR UPDATE SKIP LOCKED`-style claiming allows multiple worker replicas later without duplicate execution.
- Fallback polling handles missed or delayed webhook deliveries.

## Components and responsibilities

### GitHub webhook receiver

Extend the existing `/api/webhooks/github-app` endpoint to accept signed `workflow_run` events. Return `202` quickly, then process the event asynchronously like the existing push handler.

For `workflow_run.completed`:

1. Resolve the local repository from the GitHub repository identity and installation.
2. Upsert the existing `WorkflowRun` mirror.
3. Ignore runs for repositories without enabled managed CI.
4. Ignore successful, cancelled, or intentionally skipped runs.
5. Fetch enough job/step/log detail to classify a failure.
6. Enqueue one retry job when the failure is retryable.

Webhook deliveries must be idempotent. The GitHub delivery ID should be recorded or otherwise deduplicated so a repeated delivery cannot create duplicate retry jobs.

### GitHub DevOps provider

Extend the existing provider interface with narrowly scoped methods:

- list jobs for a workflow run;
- download/read the failed job log when required for classification;
- rerun failed jobs for a workflow run.

The rerun call uses the GitHub REST endpoint:

`POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs`

It must use a GitHub App installation token, not a customer PAT. The App requires repository `Actions: write` permission. GitHub documents this endpoint and its installation-token support in the [workflow runs REST API](https://docs.github.com/en/rest/actions/workflow-runs).

### Failure classifier

The classifier is an allowlist-based policy, not an LLM decision. It receives normalized job data and a bounded, redacted log excerpt.

Retryable examples:

- `REFUSED_STREAM`, `connection reset`, `ECONNRESET`, `socket hang up`;
- `ETIMEDOUT`, `timeout`, or temporary DNS/connectivity failure;
- HTTP `502`, `503`, or `504` from SonarQube/GitHub;
- GitHub runner startup failure or a transient runner-unavailable message;
- a job timeout where no repository command has failed.

Non-retryable examples:

- failed `lint`, `typecheck`, `test`, or `build` steps;
- SonarQube quality gate failure caused by reported issues;
- compile errors, assertion failures, dependency errors, or syntax errors;
- cancelled or skipped runs;
- authentication, permission, missing-secret, or invalid-project-key errors.

The initial implementation should be conservative: when the classifier cannot identify a known transient signature, it must not retry automatically.

### PostgreSQL retry queue

Add a dedicated `CiRetryJob` model rather than overloading `WorkflowRun` with queue state. The job should include:

- repository and organization IDs;
- source workflow run ID and the latest rerun ID;
- workflow name, workflow ID, head SHA, and branch for correlation;
- retry status: `PENDING`, `PROCESSING`, `TRIGGERED`, `SUCCEEDED`, `EXHAUSTED`, or `SKIPPED`;
- attempt count and maximum attempts (initially 2);
- retry reason/category and redacted diagnostic summary;
- `nextAttemptAt`, `lockedUntil`, `lastError`, `createdAt`, and `updatedAt`;
- a unique idempotency key based on repository, workflow identity, head SHA, and retry cycle.

The worker claims due jobs atomically, sets a short lease, and clears/extends the lease on completion. An expired lease can be reclaimed after a worker crash.

### Retry worker

Run the worker as a separate production service using the existing API image and a worker command. It should:

1. claim one due job;
2. re-check repository CI status and retry count;
3. mint an installation token through the existing GitHub App auth flow;
4. call `rerun-failed-jobs`;
5. record the GitHub response and mark the job `TRIGGERED`;
6. let the next `workflow_run` event reconcile the new attempt;
7. use exponential backoff with jitter for transient GitHub API failures;
8. stop after two automatic retries and mark the job `EXHAUSTED`.

The worker must never run more than one retry for the same idempotency key at a time. Per-installation and per-organization concurrency limits should protect GitHub rate limits and prevent a retry storm.

### Fallback reconciliation

The worker periodically checks recently completed runs for enabled repositories whose webhook state is stale. This is a bounded reconciliation pass, not an unbounded scan:

- only repositories with enabled managed CI;
- only a recent time window;
- only runs not already mirrored or already linked to a retry cycle;
- rate-limit-aware batching per GitHub installation.

The existing manual Sync endpoint remains available as an operator fallback.

## Retry state and outcome flow

```text
completed failure
      |
      +-- non-retryable --> SKIPPED / terminal failure
      |
      +-- retryable ------> PENDING (attempt 0)
                              |
                              +-- worker trigger success --> TRIGGERED
                              |                               |
                              |                               +-- success --> resolved
                              |                               +-- transient failure --> PENDING (attempt 1)
                              |                               +-- code failure --> terminal failure
                              |
                              +-- attempts exhausted --> EXHAUSTED
```

The dashboard should expose the retry status alongside the existing workflow run history, with concise customer-facing copy such as `Auto-retry scheduled`, `Retrying (1/2)`, and `Automatic retry limit reached`.

## Error handling and safety

- Webhook processing failures are logged with delivery ID, repository ID, and run ID, never tokens or raw logs.
- GitHub 401/403, missing permissions, missing secrets, and invalid repository references are terminal and visible to the customer.
- GitHub 429 responses respect `Retry-After` and are rescheduled without consuming a retry attempt when appropriate.
- The worker uses bounded log downloads and redacts bearer/token-like strings before persistence.
- Retry jobs are paused when the repository is disabled or the GitHub App installation is suspended.
- A feature flag should allow operators to disable automatic retries globally during rollout.
- Nginx/access logging must not include the GitHub/Sonar token used as the HTTP basic-auth username.

## Observability

Record structured events for:

- webhook received and deduplicated;
- failure classified as retryable/non-retryable;
- retry queued, claimed, triggered, rescheduled, exhausted, or skipped;
- GitHub API response class and rate-limit behavior;
- final rerun outcome.

Metrics should include retry queue depth, retry success rate, exhausted jobs, classification counts, and average retry latency. Logs must use repository ID/run ID, not secrets or full customer log bodies.

## Testing strategy

### Unit tests

- classify each allowlisted transient signature;
- reject code/test/lint/build/quality-gate/auth failures;
- compute backoff and maximum-attempt behavior;
- deduplicate the same webhook and retry idempotency key;
- normalize GitHub jobs and workflow-run payloads;
- map provider responses and rate-limit errors.

### Integration tests

- signed `workflow_run.completed` webhook creates one retry job;
- duplicate delivery does not create another job;
- worker claim is exclusive under concurrent workers;
- rerun API success persists `TRIGGERED`;
- worker crash leaves a reclaimable lease;
- a later successful rerun closes the retry cycle;
- disabled repositories and suspended installations do not retry.

### End-to-end verification

Use a controlled SonarQube connection failure in a test repository, confirm DevInsight triggers failed-job rerun automatically, then restore connectivity and confirm the second run appears in SonarQube and DevInsight. Also verify a deliberate test failure is not retried.

## Rollout

1. Add provider methods, classifier, schema, and webhook handling behind `CI_AUTO_RETRY_ENABLED=false`.
2. Enable the worker in staging with one test repository.
3. Enable for one production organization and inspect retry metrics/log redaction.
4. Enable by default after confirming no code failures are being retried.
5. Keep the maximum at two retries unless operational data justifies a change.
