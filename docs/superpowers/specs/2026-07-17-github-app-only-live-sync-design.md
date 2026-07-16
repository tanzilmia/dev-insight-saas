# GitHub App-Only Live Commit Sync and PAT Removal Design

**Date:** 2026-07-17  
**Status:** Approved for implementation planning  
**Scope:** GitHub integration, repository onboarding, commit ingestion, initial history collection, PAT removal, destructive data migration, and related web/API cleanup

## 1. Context

DevInside currently has two GitHub access paths:

1. a legacy organization-scoped Personal Access Token (`GitCredential`) used to list repositories, collect activity, register one webhook per repository, and resolve GitHub users; and
2. a GitHub App installation path that mints short-lived installation tokens and already supports repository discovery, activity collection, CI management, and SonarQube provisioning.

The production target is GitHub App-only. A customer selects repositories while installing or configuring the GitHub App. DevInside must automatically import recent history and then update Neon whenever a developer pushes a new commit. Customers must never create, paste, rotate, or grant a PAT.

The GitHub App webhook endpoint already verifies the App-wide HMAC secret and handles the default `installation` and `installation_repositories` events. It does not yet process `push`. The existing push ingestion service is tied to a stored PAT and its rapid-push debounce records only a trailing flag, not the latest payload, so a close second push can be missed.

## 2. Goals

- Make the GitHub App the only GitHub authentication mechanism.
- Automatically track every repository selected in a linked GitHub App installation.
- Queue an initial 90-day commit backfill for every selected repository.
- Collect all active branches, subject to the existing 25-branch safety cap.
- Ingest future pushes automatically into Neon within seconds of GitHub delivery.
- Store commits, branch membership, contributor identities, commit details, and repository live-sync timestamps through the existing ingestion pipeline.
- Keep webhook handling tenant-safe, idempotent, fast, and free of long-lived credentials.
- Fix rapid-push handling so every verified payload is processed in FIFO order.
- Remove all PAT UI, API, runtime code, provider webhook-registration code, and database storage in the same release.
- Permanently delete every repository without a matching active GitHub App access grant, including its associated local domain data.

## 3. Non-goals

- Real-time pull-request or review ingestion. This release subscribes only to `push`; PR/review synchronization remains explicit or scheduled.
- Browser push/SSE/WebSocket updates. Neon updates automatically, but an already-open dashboard may require its normal refresh/refetch cycle.
- Full-history automatic onboarding. The automatic window is 90 days; the existing Deep Collect workflow remains the explicit full-history option.
- Scheduled GitHub polling as a backup transport.
- GitLab or Bitbucket App support.
- Automatic VPS deployment from GitHub Actions.
- Deleting external SonarQube projects or GitHub resources. The destructive cleanup is limited to DevInside's database; the current database has no registered legacy per-repository GitHub webhooks to remove remotely.
- Renaming `GIT_TOKEN_ENCRYPTION_KEY`. The same encryption primitive protects non-PAT secrets such as channel and Sonar tokens, so changing its production contract is unrelated and risky.

## 4. Product Behavior

### 4.1 Repository onboarding

The customer installs the DevInside GitHub App and chooses repositories on GitHub. Linking or synchronizing the installation reconciles those repositories into DevInside. No second repository picker or PAT form exists in DevInside.

For each App-selected repository, DevInside ensures one system-owned 90-day `CollectionJob`. The existing worker collects all active branches up to the 25-branch cap. The job is persisted in PostgreSQL, survives API restarts, respects rate-limit resume behavior, and appears through the existing collection-job status UI.

### 4.2 New pushes

A local commit does not update DevInside until it is pushed to GitHub. After `git push`:

1. GitHub sends a signed `push` delivery to `POST /api/webhooks/github-app`.
2. DevInside verifies `X-Hub-Signature-256` against `GITHUB_APP_WEBHOOK_SECRET` using the raw request bytes.
3. The payload's installation ID and numeric repository ID must match a linked installation, the installation's DevInside organization, the local repository row, and an active `RepositoryAccess` grant.
4. DevInside answers GitHub with `202 Accepted` before collection starts.
5. A short-lived installation token is minted for the repository.
6. The exact pushed SHAs, branch, author information, and commit details are ingested through the existing activity pipeline.
7. SHA uniqueness makes redeliveries idempotent.
8. The repository is marked `webhookStatus = ACTIVE` and `lastWebhookAt = now` after success. A collection failure marks `webhookStatus = ERROR`.

### 4.3 Repository removal

App selection is the source of truth. When GitHub reports that repository access was removed, DevInside removes the corresponding `RepositoryAccess`. If no active App access remains for that repository, DevInside permanently deletes the local repository and its associated data. A later re-selection creates a fresh repository record and fresh 90-day backfill.

Disconnecting or uninstalling an App installation likewise deletes repositories that depend on that installation. DevInside no longer offers a local "untrack but leave selected on GitHub" action because the next App sync would recreate the repository.

## 5. Architecture

### 5.1 GitHub App webhook controller

`github-app.webhook.controller.ts` remains the single public App webhook endpoint and raw-body HMAC boundary. It will:

- preserve `ping -> 200`;
- preserve default `installation` and `installation_repositories` dispatch;
- parse and dispatch `push` payloads;
- return `400` for malformed JSON and `401` for invalid signatures;
- return `202` immediately for valid asynchronous events; and
- ignore unsupported event names without doing work.

GitHub automatically sends `installation` and `installation_repositories`; they are not manually selectable. After this release is deployed, the operator explicitly selects the `Push` event in the GitHub App settings.

### 5.2 App push routing

A focused GitHub App push service owns external-payload-to-tenant mapping. It accepts only the payload fields needed by the system (`installation.id`, `repository.id/full_name`, `ref`, `commits`, and `head_commit`). It looks up the local repository with all of these constraints:

- the GitHub installation is linked locally;
- the repository belongs to the installation's DevInside organization;
- provider is GitHub;
- external repository ID matches the payload;
- `appInstallationId` matches; and
- an active `RepositoryAccess` row exists for the same installation and repository.

Unknown, unlinked, removed, stale, or cross-tenant deliveries are safely ignored.

### 5.3 Shared push ingestion

The reusable commit-ingestion portion of the old PAT webhook service moves behind an activity-oriented boundary rather than a credential/webhook-registration boundary. It resolves GitHub access exclusively from `Repository.appInstallationId`, mints an installation token, and calls the existing `ingestPushedCommits` or recent-window fallback.

The rapid-push state changes from `running Set + trailing Set` to a per-repository FIFO payload queue. Every verified push is appended and processed sequentially, so a third push cannot overwrite the still-pending second push. SHA deduplication protects overlapping commit lists and redeliveries.

The VPS currently runs one API instance, so this in-memory per-repository serial queue matches the supported deployment model. The persistent 90-day job, later manual collection, and SHA deduplication remain recovery paths for an API restart between `202` and ingest completion.

### 5.4 Initial backfill

An internal, actor-free `ensureInitialAppBackfill` operation creates a `CollectionJob` with:

- `requestedById = null` to identify system onboarding;
- `rangeStart = now - 90 days`;
- `rangeEnd = now`;
- `verify = true` so an existing coverage ledger cannot hide commit-first/push-later holes; and
- `currentPhase = queued`.

It is idempotent: an existing system onboarding job prevents another. The existing partial unique index also prevents concurrent active jobs. A conflicting active manual job is not cancelled; a later App Sync or push can ensure the system job after the conflict clears.

Backfill is ensured after repository reconciliation and on a valid App push. Queue failure is logged without failing installation link/sync or webhook acknowledgement.

### 5.5 App-only access resolver

The repository and organization access resolver no longer checks `GitCredential`. It requires a linked GitHub App installation and returns a short-lived installation token plus the existing read provider. Missing access produces an App-specific actionable error.

All consumers—activity collection, contributor discovery, pull-request collection, repository resync, CI management, Sonar provisioning, deep collection, and GitHub username resolution—use this App-only resolver.

## 6. PAT Surface Removal

### 6.1 Backend/API

Remove:

- the `credentials` module's PAT connect/list/validate/reconnect/access/delete behavior;
- the `/api/git-credentials/*` PAT routes;
- PAT-backed `/api/repositories/sync` and `/api/repositories/select`;
- per-repository live-sync enable/disable routes;
- `POST /api/webhooks/github/:repositoryId`;
- PAT webhook registration/deletion logic from `repositories.service.ts`;
- `createWebhook`/`deleteWebhook` from `GitProvider` and the GitHub provider;
- PAT-related schemas, DTOs, client methods, tests, and documentation; and
- `PUBLIC_API_URL`, which existed only to construct the retired per-repository webhook URL.

GitHub username resolution is still required by employee mapping. It moves to an App-named endpoint/service (for example `GET /api/github-app/resolve-user`) and uses the organization installation token.

Repository list, project assignment, resync, Sonar mapping/provisioning, collection, CI, and App installation management remain.

### 6.2 Frontend

The Git settings page contains only the GitHub App connection card. Remove PAT entry, validation, reconnect, affiliation, and deletion controls.

The repositories page removes:

- PAT "Sync from GitHub" and repository-selection flows;
- the manual live-sync toggle; and
- local untrack behavior that conflicts with App selection as source of truth.

Repositories selected in GitHub appear after installation callback/webhook reconciliation or manual App Sync. The existing live badge uses `webhookStatus` and `lastWebhookAt`; its state is driven by App push deliveries rather than a per-repository hook record.

## 7. Destructive Database Migration

The migration is intentionally destructive and runs in one explicit PostgreSQL transaction.

### 7.1 Deletion set

Every `Repository` row that is not backed by a matching active App access grant is doomed. Concretely, this includes rows where `appInstallationId IS NULL` and rows where no `RepositoryAccess` exists for the same repository and `appInstallationId`. This removes PAT-linked, already-orphaned, and stale formerly-selected repositories. Their IDs are captured before schema changes.

Before deleting repository rows, remove records whose repository references are not protected by foreign keys:

- `Report` rows whose `repositoryId` is doomed; `ReportContributor` then cascades;
- `ReportSchedule` rows whose `repositoryId` is doomed; and
- `CodeQualitySnapshot` rows whose organization/project key matches a doomed repository's non-null Sonar project key; and
- repository-specific audit rows whose `entityId` is a doomed repository ID or whose metadata identifies a doomed `repositoryId`.

Deleting the repository then cascades its commits/changed files, branches and commit-branch links, contributor identities and employee mappings, coverage, collection jobs, pull requests/reviews, CI configuration, workflow runs, repository access grants, and other repository-owned relational data.

Organization-wide reports, schedules, and audit records not targeting a doomed repository are retained.

### 7.2 Schema removal

After data deletion:

- drop the `Repository.credentialId` foreign key, index, and column;
- drop `Repository.webhookExternalId` and `Repository.webhookSecret`;
- retain `Repository.webhookStatus` and `Repository.lastWebhookAt` for App delivery health;
- drop the `GitCredential` table;
- drop the unused `CredentialStatus` enum; and
- change the `Repository.appInstallation` foreign key to `onDelete: Cascade`, while application cleanup still removes non-FK report/schedule/snapshot data before installation deletion.

There is no PAT compatibility mode and no rollback path for deleted repository data. The operator may take a Neon snapshot before deployment, but implementation and rollout do not depend on preserving deleted data.

## 8. Runtime Deletion Helper

The migration cleanup rules are also needed after deployment when a repository is deselected or an App is disconnected/uninstalled. A bounded repository-deletion service will:

1. delete repository-targeted reports and schedules;
2. delete repository-mapped code-quality snapshots and repository-specific audit rows;
3. delete repository rows and rely on FK cascades for owned data; and
4. run transactionally.

Installation reconciliation calls this helper only for repositories with no remaining active `RepositoryAccess` grant. Installation disconnect/delete calls it before removing the installation.

## 9. Error Handling and Security

- Invalid or missing App webhook signatures return `401` and perform no lookup or mutation.
- Malformed signed JSON returns `400`.
- Valid asynchronous events return `202` quickly.
- Installation ID, organization, repository external ID, `appInstallationId`, and access grant must agree before ingest.
- Removed repository access invalidates old/redelivered push payloads.
- Installation tokens are minted per operation, never persisted, never returned to the browser, and never logged.
- Webhook secrets, private keys, raw authorization headers, and commit payloads are not logged.
- GitHub rate limits and transient failures use existing collection-worker retry/resume behavior for backfill.
- Push-ingest failures set repository live status to `ERROR`; later pushes and collection jobs recover missing SHAs.
- Duplicate deliveries are harmless because repository/SHA storage is idempotent.

## 10. Testing Strategy

### 10.1 Unit/service tests

- valid, invalid, missing, and tampered App webhook signatures;
- `push` routing after signature verification;
- correct installation/repository/access mapping;
- unknown installation, wrong repository ID, stale App link, removed grant, and cross-tenant payload rejection;
- exact branch and pushed-SHA ingestion using a mocked GitHub provider;
- duplicate delivery idempotency;
- rapid pushes preserve FIFO order and process every verified pending payload;
- App-only access resolver succeeds for an installation and rejects missing App access;
- initial 90-day job fields, `verify = true`, system ownership, and idempotency;
- App reconciliation queues new/existing missing backfills;
- installation/repository removal invokes transactional repository cleanup; and
- GitHub username resolution continues through the App route.

### 10.2 Migration verification

Run the migration against a disposable PostgreSQL database seeded with:

- an App-linked repository and dependent data;
- a PAT-linked repository and dependent data;
- an orphan repository and dependent data;
- repository-targeted reports/schedules; and
- unrelated organization-wide data.

Assert that App-linked data and unrelated organization data survive, PAT/orphan repositories and associated data disappear, and the PAT table/columns/enum and per-repo webhook-secret columns no longer exist.

### 10.3 Repository-wide verification

- Prisma generate and schema validation;
- API and web typecheck;
- lint;
- all tests;
- API and Next.js production builds;
- static search confirming no PAT routes, UI, types, `GitCredential`, `credentialId`, per-repo webhook registration, or `PUBLIC_API_URL` references remain except historical migration/docs context intentionally retained.

## 11. Production Rollout

1. Optionally take a Neon snapshot; deletion is otherwise accepted as permanent.
2. Push the implementation and pull it on the VPS.
3. Rebuild/recreate the API and web. The API entrypoint applies the destructive migration before start.
4. Confirm the API health check and migration completion.
5. Ensure GitHub App URL, webhook URL, active flag, and webhook secret are correct.
6. Re-approve the App installation permissions, including Secrets read/write for Sonar provisioning.
7. Select the `Push` event in GitHub App settings and save.
8. In DevInside Git settings, run App Sync so existing App repositories reconcile and initial backfills are ensured.
9. Push a small commit to a non-default branch in a selected test repository.
10. Confirm the GitHub delivery received `202`, the API did not log secrets, and Neon contains the commit/branch/contributor updates with a fresh `lastWebhookAt`.
11. Confirm the system 90-day collection job completes across available branches.
12. Confirm PAT/orphan repositories and PAT UI/API are gone, while App-linked repository CI and Sonar controls still work.

## 12. Success Criteria

- A customer can use every GitHub-backed DevInside feature without entering a PAT.
- Every App-selected repository is automatically represented in DevInside.
- An initial 90-day, up-to-25-branch backfill is queued without blocking App setup.
- A pushed commit appears in Neon automatically within the normal background-ingest delay.
- Rapid and duplicate deliveries do not lose or duplicate commits.
- Cross-tenant, stale, removed, or unsigned deliveries cannot mutate data.
- No PAT credential storage, API, UI, resolver fallback, per-repo webhook secret, or PAT repository workflow remains.
- Every repository without a matching active GitHub App access grant and its associated domain data is permanently removed by the migration.
- Full test/typecheck/lint/build verification passes before deployment.
