# DevInsight SonarQube CI Dogfood Design

**Date:** 2026-07-17  
**Status:** Approved for implementation

## 1. Context

DevInsight already has the end-to-end multi-tenant SonarQube provisioning path:

- an operator-level SonarQube credential stays in the API environment;
- a manager can select **Enable scan** for a tracked repository;
- the backend creates or reuses a tenant-safe SonarQube project;
- the backend generates a project-scoped analysis token;
- the GitHub App writes `SONAR_TOKEN` and `SONAR_HOST_URL` into repository
  Actions secrets;
- the backend persists the project mapping and opens a pull request containing
  the managed CI workflow; and
- the Code Quality provider reads the resulting measures back into DevInsight.

The VPS SonarQube server is reachable at
`https://devinside.softathena.com/sonarqube` and reported `UP` during design
validation. The repository also has a local scanner configuration and local scan
script. However, the repository's handwritten `.github/workflows/ci.yml` does
not run SonarQube, and the VPS does not currently contain a project with the
legacy local key `devinsight`.

This work will dogfood the same panel-driven provisioning flow that client
repositories use. No client or operator will manually copy an analysis token
into GitHub.

## 2. Goals

1. Enable SonarQube scanning for the DevInsight repository through the existing
   **Enable scan** panel action.
2. Keep the operator/admin SonarQube token server-side and give GitHub Actions a
   generated project-scoped token only.
3. Run Community Build analysis only for pushes to the repository's default
   branch, with complete Git history for SCM blame.
4. Fail the separate SonarQube CI job when the Quality Gate is red or the scan
   cannot complete.
5. Produce API coverage before scanning when the repository exposes a coverage
   script, so `apps/api/coverage/lcov.info` is available to the existing
   `sonar-project.properties` configuration.
6. Make the DevInside-managed workflow the canonical workflow after it has been
   verified, avoiding permanent duplicate CI runs.
7. Upgrade the managed scanner action away from the vulnerable v4 line and pin
   it immutably.

## 3. Non-goals

- Manual creation of the SonarQube project, analysis token, or GitHub secrets.
- Pull-request or feature-branch analysis. The deployed Community Build supports
  the main branch only; scanning feature branches would pollute the main view.
- SonarCloud migration, pull-request decoration, or a SonarQube edition change.
- Redesigning the existing provider, registry, encryption, GitHub App, or
  repository-provisioning architecture.
- Automatically fixing code-quality findings or weakening the Quality Gate to
  make the first run green.
- Removing historical SonarQube projects or tokens unrelated to this repository.

## 4. Chosen approach

Use the existing panel-driven provisioning service without a special manual path
for the DevInsight repository. Improve the generic managed Node workflow so it
is correct for this repository and remains reusable for clients, then activate
the repository through the panel.

The alternatives were rejected as follows:

- provisioning automatically but hand-editing DevInsight's existing CI would
  not exercise the workflow-generation promise made to clients; and
- manual project and secret setup would bypass the product architecture and
  create an undocumented operator-only path.

## 5. Architecture and data flow

1. A manager selects **Enable scan** for the DevInsight repository.
2. `provisionRepositoryCodeQuality` validates authorization,
   `SONAR_PUBLIC_URL`, the configured provider, and GitHub App repository
   access before creating SonarQube state.
3. The code-quality provider reuses an explicitly mapped project key when one
   exists; otherwise it creates the existing tenant-safe key derived from the
   organization, owner, and repository.
4. The provider creates a fresh project-scoped analysis token. The global/admin
   token remains in the API environment and is never sent to GitHub.
5. The GitHub provider sealed-box encrypts and writes the generated token as
   `SONAR_TOKEN`, and writes the public HTTPS server URL as `SONAR_HOST_URL`.
6. The backend stores the Sonar project mapping, encrypted analysis token, and
   provisioning timestamp, with the existing audit log.
7. `enableCi` opens or refreshes the managed-workflow pull request.
8. After the pull request is reviewed and merged, a push to `main` starts both
   the normal verification job and the separate `code_quality` job.
9. The code-quality job checks out full history, prepares the Node workspace,
   generates optional Prisma artifacts and coverage, then scans and waits for
   the Quality Gate.
10. SonarQube processes the report. DevInsight reads the same project key through
    its existing overview, appraisal, trend, and reporting paths.

The managed workflow pull request remains the review boundary for repository
mutation. Provisioning is automatic; merging generated code is still an
intentional repository-owner action.

## 6. Managed workflow changes

### 6.1 Template version

Bump the deterministic managed Node template from `node@v2` to `node@v3`.
This lets the existing marker/content-aware CI management code recognize the
new contract and open update pull requests instead of treating v2 as current.

### 6.2 Optional preparation scripts

Extend stack detection with two exact root-script capabilities:

- `prismaGenerate`: `package.json` contains `prisma:generate`; and
- `testCoverage`: `package.json` contains `test:coverage`.

The verification job runs the Prisma generation command before typecheck, lint,
test, and build when detected. No command is invented when the script is absent.

The DevInsight root package will expose a workspace-fanning `test:coverage`
script, matching the existing root `test` convention. The code-quality job runs
the detected coverage command before scanning. Workspaces without a coverage
script continue to scan without fabricating a coverage command or report path.

### 6.3 Sonar job

When `sonarProjectKey` is present, the generated `code_quality` job will:

- run only when `github.event_name == 'push'`;
- use `actions/checkout` with `fetch-depth: 0`;
- set up the detected package manager and Node version;
- install dependencies deterministically;
- run detected Prisma generation and coverage commands;
- invoke `SonarSource/sonarqube-scan-action` pinned to the immutable v8.1.0
  commit `7006c4492b2e0ee0f816d36501671557c97f5995`;
- read only `SONAR_TOKEN` and `SONAR_HOST_URL` from GitHub Actions secrets; and
- pass these fixed scanner arguments:
  - `-Dsonar.projectKey=${sonarProjectKey}` (rendered from the trusted backend value)
  - `-Dsonar.qualitygate.wait=true`
  - `-Dsonar.qualitygate.timeout=300`

The fixed project key comes from the backend's trusted repository record, not
from pull-request input. The v8.1.0 pin is beyond the action's patched v5.3.1
boundary for CVE-2025-58178 and prevents a mutable major tag from changing the
executed supply-chain dependency unexpectedly.

## 7. Security and configuration

- The global/admin `SONAR_TOKEN` remains only in the API/VPS environment. It is
  used to create projects and mint project tokens, never to scan client code.
- The generated analysis token is scoped to one SonarQube project. It is stored
  in GitHub as an encrypted Actions secret and in DevInsight through the existing
  AES-256-GCM token encryption. It is never returned by an API response or logged.
- `SONAR_PUBLIC_URL` is non-secret configuration and must be set in the live API
  environment to `https://devinside.softathena.com/sonarqube`. The committed
  production example already documents this variable; no real credential will
  be committed.
- The GitHub App installation must grant `Secrets: read & write`, and the
  installation must be re-accepted after a permission change. A missing
  permission remains a typed provisioning error.
- The generated workflow keeps global `permissions: contents: read`. Repository
  secret access does not require granting the workflow write permissions.
- The SonarQube URL uses HTTPS so the project token is never sent over plaintext.

## 8. Failure handling and retry behavior

Provisioning is an explicit manager action, so failures surface clearly instead
of degrading silently.

- Missing public URL, provider configuration, GitHub App access, or provider
  provisioning support fails before the SonarQube project is mutated where the
  existing order permits it.
- Project creation is idempotent. An existing project is reused.
- Retrying token generation revokes the same named prior token, creates a fresh
  token, overwrites both GitHub secrets, and then updates the encrypted database
  state.
- If a failure occurs after the project or token is created, retrying **Enable
  scan** is the recovery path; no manual secret entry is required.
- A scanner transport/authentication error fails only `code_quality`; the
  separate correctness job still reports its own result.
- A red Quality Gate fails `code_quality` after SonarQube computes the gate. The
  explicit timeout is 300 seconds.
- The first scan is allowed to be red. The implementation must report the real
  gate result rather than lowering thresholds or hiding existing findings.

## 9. Canonical CI transition

The panel initially creates `.github/workflows/devinside-ci.yml` while the
handwritten `.github/workflows/ci.yml` still exists. This short overlap is an
intentional migration window.

After the managed pull request is merged:

1. confirm the managed `verify` job runs the repository-specific Prisma step and
   passes its normal checks;
2. confirm `code_quality` publishes an analysis and reflects the Quality Gate;
3. remove the handwritten `.github/workflows/ci.yml`; and
4. keep `.github/workflows/devinside-ci.yml` as the sole canonical CI workflow.

The old workflow is not removed before the managed verification path is proven.

## 10. Testing and live verification

### 10.1 Automated tests

Update stack-detector tests to cover present and absent `prisma:generate` and
`test:coverage` scripts. Update workflow-template tests to verify:

- the `node@v3` marker;
- optional Prisma and coverage commands;
- omission of optional commands when scripts are absent;
- push-only Sonar execution;
- full-history checkout;
- the immutable v8.1.0 action SHA;
- secret references without embedded values;
- the provisioned project key;
- Quality Gate wait and timeout arguments; and
- deterministic npm, pnpm, and yarn command rendering.

Run the repository's full unit tests, typecheck, lint, and build. Validate the
generated YAML structurally before live activation.

### 10.2 Live dogfood acceptance

1. Confirm the VPS API has `SONAR_PUBLIC_URL` and an admin/create-project-capable
   SonarQube token without displaying either token.
2. Confirm the DevInsight GitHub App installation includes the DevInsight
   repository and has `Secrets: read & write`.
3. Use the panel's **Enable scan** action.
4. Confirm a SonarQube project is created or reused and the repository record has
   a project key and provisioning timestamp.
5. Confirm GitHub reports the `SONAR_TOKEN` and `SONAR_HOST_URL` secret names;
   never inspect or print their values.
6. Confirm the managed workflow pull request contains `node@v3` and the expected
   Sonar job, then merge it through the normal review boundary.
7. Observe the next `main` workflow. The verification job must pass independently.
   The Sonar job must upload an analysis and match the computed Quality Gate,
   including failing when the gate is red.
8. Confirm the analysis appears in SonarQube and DevInsight's Code Quality views.
9. Remove the legacy handwritten workflow only after the managed verification
   job has demonstrated parity.

## 11. Success criteria

The work is complete when:

- activation occurred through the panel with no manual project, token, or GitHub
  secret entry;
- the GitHub workflow uses a generated project-scoped analysis token, not the
  global/admin token;
- scans run only after pushes to the default branch and include full Git history;
- API coverage is imported when available;
- the Sonar job waits for and truthfully enforces the Quality Gate;
- results are visible from both the VPS SonarQube project and DevInsight;
- automated checks cover the new template behavior; and
- the managed v3 workflow becomes the repository's sole canonical CI workflow
  after the migration window.

## 12. References

- SonarSource, “Adding analysis to GitHub Actions workflow”: scanner secrets,
  full-history checkout, and Quality Gate wait behavior.
- SonarSource `sonarqube-scan-action` v8.1.0 release/tag.
- GitHub advisory GHSA-f79p-9c5r-xg88 / CVE-2025-58178: action versions 4 through
  5.3.0 are affected; 5.3.1 is the first patched release.
