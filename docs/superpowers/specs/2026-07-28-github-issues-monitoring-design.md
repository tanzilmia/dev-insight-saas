# GitHub Issues Monitoring Design

**Issue:** #9 — `feat: sync GitHub Issues into DevInsight for work tracking and reporting`

**Branch:** `feat/9-github-issues-monitoring`

## Goal

GitHub remains the source of truth for work items. DevInsight reads selected
repositories' GitHub Issues through the existing GitHub App installation,
stores a tenant-scoped reporting mirror, and exposes workflow signals to
managers and other authorized organization members. DevInsight does not create,
edit, or close GitHub Issues in this increment.

## MVP scope

- Add normalized issue and issue-event types to the `GitProvider` abstraction.
- Implement GitHub issue listing with pagination and provider error handling.
- Persist the current issue snapshot and an append-only event history.
- Add a manager-gated repository collection endpoint, following the existing
  pull-request collection pattern.
- Map issue authors and assignees through existing GitHub aliases and contributor
  mappings; preserve the raw login when no employee is mapped.
- Add organization-member read endpoints for issue lists and aggregate metrics.
- Surface repository issue collection and basic issue metrics in the dashboard.
- Make issue metrics available to reporting/analysis services without making
  issue count a performance verdict.
- Add unit tests for provider normalization, idempotent persistence helpers,
  mapping, and metric calculations.

## Explicit non-goals

- Creating or editing issues from DevInsight.
- Synchronizing issue comments in the first increment.
- Full issue notification rules or scheduled issue digests.
- Replacing GitHub Projects, Jira, or another work-management system.

## Data model

`GitHubIssue` is a read model scoped by repository and external issue number.
It stores the latest provider snapshot: title, body, state, author login,
assignee logins, labels, milestone, timestamps, URL, and `syncedAt`. The unique
key is `(repositoryId, number)` and all repository relations cascade with the
existing tenant data boundary.

`GitHubIssueEvent` stores provider event identity and normalized event type,
actor, payload metadata, and occurred-at time. The unique key is
`(issueId, externalId)` so repeated collection is safe. Collection will record
state/assignment/label changes observed in the provider snapshot; it will not
invent events when GitHub has not supplied them.

## Data flow

```text
Manager starts collection
  -> resolve repository installation token
  -> GitProvider.listIssues()
  -> upsert issue snapshots and observed event rows in a transaction
  -> refresh mapping/reporting reads from the local mirror
```

The provider interface remains vendor-neutral. GitHub App permissions remain
read-only for Issues. Webhook support is designed as a follow-up boundary so
the initial collection path can be tested and deployed independently.

## API surface

- `POST /api/issues/collect` — manager-only; body `{ repositoryId }`.
- `GET /api/issues` — organization member; filters by organization, optional
  repository/project/state/assignee and date window.
- `GET /api/issues/metrics` — organization member; backlog, opened, closed,
  average age, average cycle time, and per-employee workload.

Responses expose GitHub URLs and safe reporting fields. Raw tenant IDs are only
returned where the authenticated dashboard already needs them; no provider
token or unrelated organization data is exposed.

## Reporting signals

- Open versus closed workload.
- Issue age for currently open work.
- Cycle time for closed work (`closedAt - createdAt`).
- Unassigned and overdue backlog.
- Issue counts by repository, project, label, and mapped employee.
- Unmapped author/assignee count as a data-quality signal.

All metrics include a clear caveat that issue count and age are workflow
signals, not a standalone employee-performance score.

## Error handling and limits

- Reuse the existing GitHub App installation-token resolver and rate-limit error
  behavior.
- Bound provider pages and issue count to avoid unbounded API/database work.
- A repeated collection must be idempotent.
- A provider failure returns a typed API error for manual collection and does
  not corrupt existing snapshots.
- Missing GitHub author/assignee data remains nullable and does not fail the
  whole repository collection.

## Testing and verification

- Provider fixture tests for pagination, empty results, malformed optional
  fields, rate limits, and GitHub API errors.
- Service tests for upsert idempotency, state changes, mapping, and metrics.
- API tests for manager/member authorization and validation.
- Existing workspace typecheck, lint, build, and test commands must remain
  green.
- Use the DevInsight repository itself as the real GitHub dogfood repository
  after the mocked/unit verification is complete.

