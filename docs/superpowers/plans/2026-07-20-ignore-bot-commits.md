# Implementation plan: ignore bot commits

1. Add `modules/git-providers/bot-identity.ts` with the shared known-login and
   `[bot]` suffix predicate; cover it with pure unit tests.
2. Replace the contributor service's private bot detection with the shared
   predicate, preserving existing `ignored` behavior for discovered identities.
3. Filter bot commits in `ingestBranchRange` before existing-commit lookup,
   detail fetching, storage, and branch-link creation.
4. Filter bot commits in `ingestPushedCommits` while continuing to update branch
   head metadata from the complete push payload.
5. Prevent bot-only webhook usernames from triggering contributor discovery.
6. Run API tests, typecheck, lint, build, inspect the diff, and update
   `docs/PROJECT_STATE.md` with the completed behavior.

No Prisma schema or migration change is needed because the filter applies before
new activity rows are written.
