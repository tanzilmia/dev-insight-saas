# SonarQube Bearer Authentication and Code Quality State Fix

## Context

The production SonarQube 26.7 instance is healthy, but DevInside's
`GET /api/code-quality/projects` endpoint returns HTTP 500. Direct diagnostics
showed that the current Basic-token request receives an HTML document, which the
provider attempts to parse as JSON. The same endpoint returns valid JSON when
the token is sent with Bearer authentication.

The Code Quality page compounds the backend failure in two ways:

- connection and project-list requests are coupled in one `Promise.all`, so a
  project-list failure overwrites a successful env-fallback connection with a
  false "not connected" state;
- the overview loading state starts as `true` and is never settled when no
  project key exists, leaving the page on an infinite loading indicator.

## Goals

- Authenticate all SonarQube Web API requests with Bearer tokens.
- Reject non-JSON success responses with an actionable typed application error.
- Preserve the env-fallback connection state when project listing fails.
- Settle loading when no project is selected and show a useful empty state.
- Keep tenant isolation, encrypted token storage, and existing database data
  unchanged.

## Non-goals

- No database migration or data cleanup.
- No changes to GitHub repository secrets or existing Sonar projects.
- No SonarQube connection redesign or provider abstraction rewrite.
- No new frontend test framework.

## Backend design

`SonarQubeProvider` will use `Authorization: Bearer <token>` for both GET and POST
requests. Authentication construction will be centralized so every provider
operation uses the same scheme.

The JSON request path will inspect the response `Content-Type` before parsing.
An otherwise-successful HTML or non-JSON response will throw an `AppError` with
code `CODE_QUALITY_INVALID_RESPONSE` and HTTP 502. Existing mappings remain:
401/403 becomes `CODE_QUALITY_UNAUTHORIZED`, 404 becomes
`CODE_QUALITY_PROJECT_NOT_FOUND`, and other non-success statuses become
`CODE_QUALITY_ERROR`.

The provider will not fall back to Basic authentication. The deployed SonarQube
instance and current SonarQube documentation support Bearer tokens; a silent
fallback would hide configuration problems and issue an unnecessary second
credentialed request.

## Frontend design

Connection metadata and project listing will load independently. A failed
project-list request must not replace a successful connection response. The
page will preserve the connection card and display the actionable project-list
error through the existing error presentation.

Overview loading will settle when either the organization or project key is
absent. When the provider is connected but has no mapped projects, the page will
show a stable empty state directing the manager to enable scanning from the
Repositories page. Manual project-key entry remains available for the existing
mapping workflow.

The React implementation will keep independent async work parallel, use deferred
promise callbacks consistent with the repository's Next.js 16 conventions, and
avoid synchronously setting state inside effects.

## Data flow

1. The page fetches connection metadata and the tenant-filtered Sonar project
   list independently.
2. The API resolves a per-org connection when present, otherwise the shared env
   fallback.
3. The provider calls SonarQube with Bearer authentication and validates the
   response media type.
4. A valid empty project list renders an empty state; a request failure renders
   its error without changing connection status.
5. Once a project is mapped/provisioned, the existing overview and trend flow
   runs unchanged.

## Verification

- Add API unit coverage proving Bearer headers are sent and HTML success
  responses produce `CODE_QUALITY_INVALID_RESPONSE`.
- Run API tests, typecheck, lint, and build.
- Run web typecheck, lint, and build. The repository has no web test runner, so
  verify the page states through the production reproduction checklist:
  env fallback visible, empty project list not loading forever, and backend
  failure shown without changing the connection card.
- After deployment, confirm `/api/code-quality/projects` returns 200 and the
  Code Quality page displays the env fallback plus an empty-project state.

## Deployment

No environment or database changes are required. Rebuild and recreate the API
and web images, then hard-refresh the browser. SonarQube, nginx, and Neon remain
untouched.
