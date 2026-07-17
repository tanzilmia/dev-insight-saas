# Restore Z.AI GLM-5.2 for Hosted OpenClaw

## Context

The previously verified local chat-to-report path used Z.AI GLM-5.2 through the
Global Coding Plan endpoint. During the hosted OpenClaw deployment, both the
OpenClaw agent and the DevInsight report writer were changed to Groq
`llama-3.3-70b-versatile`. The hosted runtime therefore stopped using the paid
Z.AI Coding Plan and instead consumed the Groq organization's on-demand limits.

The resulting failures are confirmed in production logs: Groq accepts the key,
but rejects new turns after the model's daily token allowance is exhausted.
OpenClaw reports the upstream rate-limit failure inside its streaming response.
The DevInsight API currently ignores that error frame, so the browser shows the
misleading message "The assistant returned an empty response."

## Goals

- Restore the known-good Z.AI GLM-5.2 Coding Plan route for both conversational
  orchestration and report generation.
- Keep the OpenClaw gateway, MCP bridge, tenant context token, and restricted
  public HTTPS ingress unchanged.
- Keep provider credentials in environment variables and out of tracked files
  and shell output.
- Surface provider failures as actionable, sanitized chat errors instead of an
  empty response.
- Preserve the reduced OpenClaw tool surface and disabled thinking mode.

## Non-goals

- No database schema or data changes.
- No GitHub App, SonarQube, nginx, MCP protocol, or tenant-authentication changes.
- No automatic retry loop for quota errors. Long-lived daily limits cannot be
  fixed by immediate retries, and retries would consume more provider capacity.
- No provider billing or plan mutation from the application.
- No removal of the Groq credential; it may remain available but inactive.

## Provider configuration

Production `deploy/.env.prod` supplies the paid Z.AI key through `ZAI_API_KEY`.
OpenClaw's official Z.AI provider reads that variable directly. The DevInsight
API uses its existing OpenAI-compatible provider adapter, so its three LLM
variables point to the same Coding Plan:

```env
ZAI_API_KEY="<paid Z.AI Coding Plan key>"
OPENAI_API_KEY="<the same Z.AI key>"
OPENAI_BASE_URL="https://api.z.ai/api/coding/paas/v4"
OPENAI_MODEL="glm-5.2"
```

Examples and documentation contain placeholders only. The real values remain in
gitignored environment files with restrictive permissions.

OpenClaw installs `@openclaw/zai-provider`, explicitly selects the Global Coding
Plan base URL, and sets its default model to `zai/glm-5.2`. Existing runtime
hardening remains in force:

- `gateway.auth.mode=token`;
- Control UI disabled;
- `tools.profile=messaging`, which retains the configured MCP tools;
- `agents.defaults.thinkingDefault=off`;
- no host publication of port 18789.

The Groq provider may remain installed and `GROQ_API_KEY` may remain in the
environment, but neither is selected by the default agent or the DevInsight
report writer.

## Request flow

The architecture does not change:

```text
Browser
  -> DevInsight API /api/openclaw/chat/stream
  -> OpenClaw /v1/chat/completions
  -> Z.AI GLM-5.2 Coding Plan
  -> DevInsight MCP tools
  -> DevInsight API report orchestration
  -> Z.AI GLM-5.2 Coding Plan report writer
  -> streamed browser reply
```

The OpenClaw agent and report writer are deliberately configured separately even
though they use the same key. OpenClaw reads `ZAI_API_KEY`; the API's generic
provider reads `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`.

## Streaming error handling

`streamChatWithAgent` will recognize both successful OpenAI-compatible SSE
chunks and top-level error payloads. It will also inspect non-stream JSON error
payloads when available.

Provider details are not passed through verbatim. In particular, organization
identifiers, raw upstream payloads, credentials, and account metadata never
reach the browser. Rate-limit-like failures map to a stable message such as:

```text
The AI service has reached its provider limit. Please try again later.
```

Other upstream failures retain the existing generic gateway error. The
controller continues returning NDJSON; a mid-stream failure becomes its existing
`{ "type": "error", "message": ... }` event, which the frontend already throws
and renders in the chat error panel.

## Deployment

Tracked configuration examples and operator documentation will describe Z.AI as
the active production route. After the code/documentation change is pushed, the
VPS workflow is:

1. Pull the new commit.
2. Confirm the four Z.AI/OpenAI-compatible environment variables are set without
   printing their values.
3. Install the official Z.AI provider through the one-off OpenClaw CLI container.
4. Set the Coding Plan base URL and `zai/glm-5.2` as the default model.
5. Recreate the API and OpenClaw gateway so both read the new environment.
6. Verify health, provider/model logs, a plain chat turn, MCP discovery, and a
   real report request.

The VPS host has no npm installation, so operator steps use raw
`docker compose` commands.

## Local development

The local API retains the shared-service topology. Its `apps/api/.env` uses the
same Z.AI report-writer variables and the same gateway/context secrets, while
these host-specific URLs remain public HTTPS values:

```env
OPENCLAW_GATEWAY_URL="https://devinside.softathena.com/openclaw"
SONAR_BASE_URL="https://devinside.softathena.com/sonarqube"
SONAR_PUBLIC_URL="https://devinside.softathena.com/sonarqube"
```

OpenClaw, MCP, and SonarQube continue to run only on the VPS.

## Verification

Automated verification covers:

- a normal streamed completion still yields text deltas;
- a streamed provider error becomes a sanitized application error;
- a non-stream provider error becomes the same sanitized error;
- raw provider payload details do not appear in the client-facing message;
- existing API tests, type checking, linting, and builds remain green.

Production acceptance requires:

- OpenClaw logs show provider `zai` and model `glm-5.2`, not Groq;
- authenticated `/openclaw/v1/chat/completions` returns a GLM response;
- the MCP probe still lists `devinsight_context` and
  `devinsight_generate_report`;
- hosted chat can answer a simple turn and generate a real repository report;
- a simulated provider failure renders a useful UI error instead of "empty
  response."

## Rollback

Rollback requires no data changes. The operator may reselect the prior Groq
model and recreate the API/gateway, or roll back the application commit. The
gateway, MCP state, tenant signing secrets, and database remain intact.

