# DevInsight OpenClaw Plugin

An OpenClaw **tool plugin** that lets the OpenClaw agent generate DevInsight
developer work reports. The agent (e.g. from the website chat box, or later
Telegram/Discord) calls these tools, which call the DevInsight backend's
service-key endpoints (`/api/openclaw/tools/*`).

> Built to the OpenClaw `plugin-sdk` contract (docs.openclaw.ai/plugins/tool-plugins).
> Because it is not compiled against the OpenClaw types in this monorepo, **verify it
> once against your installed OpenClaw version** — the `defineToolPlugin` import path
> and factory signature may need a small tweak. Fix any mismatch reported by `build`.

## Tools
- `devinsight_context` — lists the org's tracked repositories, projects, employees
  (id + name) so the agent can resolve names → ids.
- `devinsight_generate_report` — generates a repository/project/employee/team report
  for a period and returns its Markdown.

## Config (set when installing into OpenClaw)
| key | value |
|-----|-------|
| `serviceUrl` | DevInsight API base URL. From inside the OpenClaw container use **`http://host.docker.internal:4000`** (not `localhost`). |
| `apiKey` | the DevInsight `OPENCLAW_SERVICE_KEY` (same secret set in `apps/api/.env`). |
Tenant identity is not configured in the plugin. Each tool call requires the opaque,
short-lived `contextToken` supplied by the authenticated DevInsight website chat.
(the `user.id` and `organizations[].id`), or read them from the DB.

## Build & install
```bash
cd integrations/devinsight-openclaw-plugin
npm install
npm run build                      # tsc → dist/  (fix any SDK-API mismatch here)
npm run manifest                   # generates openclaw.plugin.json (contracts.tools)

# from your OpenClaw runtime:
openclaw plugins install /abs/path/to/integrations/devinsight-openclaw-plugin
# then configure the plugin (Control UI → Plugins, or CLI) with the 4 config keys above
```

## Flow once live
```
chat box → DevInsight /api/openclaw/chat → OpenClaw gateway (/v1/chat/completions,
model openclaw:main) → agent → these tools → DevInsight /api/openclaw/tools/* → report
```
See `SKILL.md` for the agent instructions, and `docs/OPENCLAW_SETUP.md` for the runtime.
