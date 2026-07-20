# Ignore bot commits during activity ingestion

## Problem

DevInsight currently marks recognized bot identities as ignored during contributor discovery, but activity ingestion still persists their commits, changed files, and branch links. As a result, automated accounts can inflate repository activity and appear as contributors in downstream reporting.

## Goal

Exclude bot-authored commits from all new activity ingestion paths:

- GitHub App push webhook ingestion
- Manual activity collection
- Automatic report collection
- Initial and deep-history backfills

Bot commits must not cause `Commit`, `ChangedFile`, or `CommitBranch` rows to be created. Bot-only pushes may still update branch metadata because the branch head is repository state, not contributor activity.

## Design

Create one shared bot-identity predicate for the Git provider domain. It will recognize:

- GitHub-style usernames ending in `[bot]`
- The existing explicit known bot login list (`web-flow`, `dependabot`, `github-actions`, `renovate`, and the other entries already used by contributor discovery)

Use this predicate in both contributor discovery and commit ingestion so the two features cannot drift apart.

At the storage boundary, filter commits before fetching commit details or creating database rows:

1. `ingestBranchRange` filters the provider's listed commits before calculating new commits and fetching details. Coverage behavior remains based on the successfully processed eligible commit set, so filtered bots do not create partial-collection or detail-cap work.
2. `ingestPushedCommits` filters webhook commits before detail fetch and storage. The branch is still upserted and its head SHA is still updated from the push payload.
3. Branch-link creation uses only IDs of stored commits, so bot commits cannot receive `CommitBranch` links.
4. Push follow-up contributor discovery ignores bot usernames when deciding whether new identities need discovery.

Existing bot rows are not deleted by this change. Deleting historical commits would cascade to changed files and branch links and could leave coverage counts stale; it will remain a separate, explicitly requested cleanup operation.

## Testing

Add unit coverage for the shared predicate, including `[bot]` suffix matching, known logins, ordinary human usernames, and null values. Add ingestion-focused coverage for:

- mixed human and bot commits, verifying only human commits are detailed and stored;
- bot-only webhook batches, verifying no commit storage occurs while branch metadata is maintained;
- backfill/list ingestion using the same filtering behavior.

Run the API unit suite plus typecheck, lint, and build.

## Non-goals

- Changing report queries to hide bot rows that are already stored
- Deleting historical bot activity
- Inferring bots from arbitrary author names or emails beyond the established GitHub login conventions
- Changing pull-request, review, workflow-run, or code-quality bot filtering
