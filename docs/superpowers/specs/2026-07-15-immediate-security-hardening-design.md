# Immediate Security Hardening Design

Date: 2026-07-15

## Goal

Remove the four immediate risks identified in the security audit without changing the
user-facing report workflow:

1. redact authentication secrets from HTTP logs;
2. rotate the local JWT and OpenClaw service secrets;
3. authenticate and restrict the standalone MCP endpoint; and
4. replace fixed MCP organization/requester configuration with verified, short-lived
   per-chat context.

The dashboard's direct report-generation endpoint remains unchanged. Website chat keeps
working for authenticated organization members. Conversational channels that cannot
provide a DevInsight-issued context token fail closed instead of inheriting a global
organization identity.

## Security Architecture

### HTTP log redaction

The API will configure `pino-http` with explicit redaction for these request headers:

- `authorization`;
- `cookie`;
- `x-openclaw-key`; and
- `x-openclaw-context`.

Redaction will use a constant censor string and remove neither the request method nor the
path, status, duration, or request id. A focused test will serialize a request containing
sentinel secrets and prove that none of the sentinel values appears in log output.

### Two independent machine-security layers

OpenClaw tool traffic will require both of these credentials:

1. `OPENCLAW_SERVICE_KEY` authenticates the MCP bridge to the DevInsight API.
2. `MCP_ACCESS_TOKEN` authenticates OpenClaw to the standalone MCP HTTP endpoint.

The credentials have different purposes and are independently generated. The MCP server
will refuse to start when its access token or DevInsight service key is missing. Bearer
comparison will be length-checked and timing-safe. `/mcp` will return `401` before MCP
request parsing for absent or invalid credentials.

The MCP listener will use `MCP_HOST`, defaulting to `127.0.0.1`. Docker-based OpenClaw may
explicitly set `MCP_HOST=0.0.0.0`; that compatibility mode remains protected by the bearer
token and must be combined with host firewall/private-network restrictions. `/health`
will expose only health status and no organization information.

### Signed tenant context

The DevInsight API is the only component allowed to mint tool context. It will create an
opaque, short-lived JWT using a new `OPENCLAW_CONTEXT_SIGNING_SECRET` that is never shared
with OpenClaw or the MCP bridge. Claims will include:

- issuer `devinsight-api`;
- audience `devinsight-openclaw-tools`;
- subject: authenticated requester id;
- organization id; and
- a ten-minute expiry.

Before minting, the website chat route will re-check active organization membership. The
chat system message will contain only this opaque context token, not trusted raw identity
instructions. MCP tools will require `contextToken` and forward it unchanged in the
`x-openclaw-context` header to DevInsight.

The service-tool middleware will verify both the service key and the context token, derive
`requesterId` and `organizationId` from verified claims, and attach them to the request.
Tool request bodies and query strings will no longer accept those identities as authority.
Business services will continue to re-check live membership, so a removed or disabled
member loses access even while an unexpired token exists.

The context token alone cannot call the API because the service key is also required. It
cannot call the MCP endpoint because that endpoint separately requires `MCP_ACCESS_TOKEN`.
The ten-minute expiry limits exposure to an LLM provider or conversation transcript.

## Request Flow

1. Browser sends its normal JWT-authenticated chat request with an organization id.
2. API verifies active membership and mints a ten-minute OpenClaw context token.
3. API sends the chat turns and opaque token to the private OpenClaw gateway.
4. The model supplies the opaque token when calling a DevInsight MCP tool.
5. OpenClaw sends its configured MCP bearer token to `/mcp`.
6. MCP verifies the bearer token, then forwards the context token and service key to the
   DevInsight tool endpoint.
7. API verifies both credentials, derives tenant identity from signed claims, re-checks
   current authorization, and performs the tool operation.

No fixed organization or requester environment variables participate in this flow.

## Component Changes

### API

- Add reusable pino redaction configuration.
- Add `OPENCLAW_CONTEXT_SIGNING_SECRET` validation.
- Add context-token mint/verify functions with strict issuer, audience, algorithm, and
  expiry checks.
- Replace the raw organization/requester system note with the opaque context token.
- Extend OpenClaw service-tool authentication to require and decode the context token.
- Remove requester and organization identity from service-tool schemas and derive it from
  authenticated request context.

### Standalone MCP bridge

- Add `MCP_ACCESS_TOKEN` and `MCP_HOST` configuration.
- Fail startup on absent required secrets or invalid port/host configuration.
- Authenticate `/mcp` with a timing-safe bearer check.
- Remove `DEVINSIGHT_ORG_ID` and `DEVINSIGHT_REQUESTER_ID`.
- Require `contextToken` in both tool contracts and forward it as a header.
- Add request body-size limits, upstream timeout, bounded error messages, and a minimal
  health response.

### Superseded TypeScript plugin

The plugin is retained as reference in the repository, so its fixed organization/requester
configuration will also be removed. Its tools will accept the same opaque context token,
preventing a future operator from accidentally restoring the vulnerable trust model.

### Runtime configuration and documentation

- Update environment examples with purpose-specific secrets and safe defaults.
- Update `run.sh` to read required secrets without fixed CUID fallbacks.
- Update OpenClaw MCP registration instructions to send an Authorization bearer header.
- Mark conversational Telegram usage unavailable until an authenticated account-linking
  flow can obtain a DevInsight-issued context token.
- Remove the documented single-org security exception.

## Secret Rotation and Rollout

The local ignored `apps/api/.env` will receive new cryptographically random values for:

- `JWT_ACCESS_SECRET`;
- `OPENCLAW_SERVICE_KEY`; and
- `OPENCLAW_CONTEXT_SIGNING_SECRET`.

A separate random `MCP_ACCESS_TOKEN` will be created for the MCP process and OpenClaw MCP
registration. The Git token encryption key is not rotated because doing so without a data
re-encryption migration would make stored Git credentials unreadable. The OpenClaw gateway
token is not rotated because the audit found no evidence that it was logged or exposed.

Rotation invalidates all existing DevInsight JWT sessions. The API, MCP bridge, and
OpenClaw gateway must be restarted/reloaded after their synchronized configuration changes.
The sequence is:

1. land code and tests;
2. update local secrets and MCP registration together;
3. restart API and MCP;
4. reload/restart OpenClaw;
5. verify unauthenticated MCP denial and authenticated end-to-end chat; and
6. require users to sign in again.

Secrets must never be printed in command output, logs, documentation, test snapshots, or
Git diffs. Verification output may show only presence, length, or a one-way fingerprint.

## Failure Behaviour

- Missing logging configuration cannot disable redaction because redaction is compiled into
  app construction.
- Missing context signing secret causes API startup validation failure when OpenClaw is
  configured.
- Invalid, expired, wrong-audience, or malformed context tokens return `401` with a generic
  code and no token detail.
- A valid token for a user whose membership is no longer active returns the existing
  authorization error from the business service.
- Missing MCP access token prevents MCP startup; invalid bearer credentials return `401`.
- Tool calls from Telegram or another channel without a minted token fail validation and
  reveal no tenant data.
- Upstream API calls from MCP time out and return a bounded generic MCP error.

## Verification

Focused automated tests will cover:

- Pino logs do not contain bearer JWTs, cookies, service keys, or context tokens.
- Context-token verification accepts the intended issuer/audience and rejects expiry,
  signature tampering, wrong issuer, and wrong audience.
- Service-tool authentication rejects missing/invalid service keys and context tokens.
- Tenant identity is derived from signed claims even if conflicting body/query ids are sent.
- MCP rejects missing/invalid bearer credentials and does not start without required secrets.
- MCP tool payloads contain no fixed tenant identity and forward the context token.

Repository-wide verification will run unit tests, typecheck, lint, and build. A local smoke
test will verify `/health`, unauthenticated `/mcp` rejection, authenticated MCP discovery,
and a website chat tool call if the local OpenClaw runtime is available.

## Non-goals

- Rotating the Git credential encryption key.
- Rotating provider keys or the OpenClaw gateway token without evidence of exposure.
- Building Telegram-to-DevInsight account linking.
- Addressing the other High/Medium audit findings in this change.
