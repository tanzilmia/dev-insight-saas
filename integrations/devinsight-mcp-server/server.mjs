import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Runs on the HOST next to DevInsight. OpenClaw (in Docker) reaches it via
// http://host.docker.internal:PORT/mcp. The MCP server reaches DevInsight at
// http://localhost:4000 (host → host).
const DEVINSIGHT_URL = process.env.DEVINSIGHT_URL ?? "http://localhost:4000";
const SERVICE_KEY = process.env.DEVINSIGHT_SERVICE_KEY ?? "";
const ORG_ID = process.env.DEVINSIGHT_ORG_ID ?? "";
const REQUESTER_ID = process.env.DEVINSIGHT_REQUESTER_ID ?? "";
const PORT = Number(process.env.PORT ?? 4100);

async function callDevInsight(path, init = {}) {
  const response = await fetch(`${DEVINSIGHT_URL}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-openclaw-key": SERVICE_KEY },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`DevInsight ${path} failed (${response.status}): ${detail}`);
  }
  return response.json();
}

function buildServer() {
  const server = new McpServer({ name: "devinsight", version: "0.1.0" });

  server.tool(
    "devinsight_context",
    "List the DevInsight organization's tracked repositories, projects, and employees (id + name). Call this first to resolve names the user mentions into ids.",
    {},
    async () => {
      const data = await callDevInsight(
        `/api/openclaw/tools/context?organizationId=${encodeURIComponent(ORG_ID)}&requesterId=${encodeURIComponent(REQUESTER_ID)}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data.context) }] };
    }
  );

  server.tool(
    "devinsight_generate_report",
    "Generate a developer work report (repository/project/employee/team) over a period from real Git activity. Returns Markdown. Resolve ids via devinsight_context first if the user gave names. For an arbitrary window (e.g. 'Jan 1 to Mar 31', 'the first 3 months of 2025'), pass period='custom' with customRange {from, to} as ISO dates (YYYY-MM-DD). Named windows: today, last_7_days, last_30_days, last_90_days, this_month, last_month.",
    {
      reportType: z.enum(["repository", "project", "employee", "team"]),
      repositoryId: z.string().optional(),
      projectId: z.string().optional(),
      employeeIds: z.array(z.string()).optional(),
      period: z
        .enum([
          "today",
          "last_7_days",
          "last_30_days",
          "last_90_days",
          "this_month",
          "last_month",
          "custom"
        ])
        .optional(),
      customRange: z.object({ from: z.string(), to: z.string() }).optional()
    },
    async (args) => {
      const data = await callDevInsight("/api/openclaw/tools/generate-report", {
        method: "POST",
        body: {
          requesterId: REQUESTER_ID,
          organizationId: ORG_ID,
          period: args.period ?? "last_7_days",
          customRange: args.customRange,
          reportType: args.reportType,
          repositoryId: args.repositoryId,
          projectId: args.projectId,
          employeeIds: args.employeeIds
        }
      });
      return { content: [{ type: "text", text: data.report?.markdown ?? "No report produced." }] };
    }
  );

  return server;
}

const app = express();
app.use(express.json());

// Stateless streamable-HTTP: a fresh server+transport per request.
app.post("/mcp", async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ error: String(error) });
    }
  }
});

app.get("/mcp", (_req, res) => res.status(405).json({ error: "Method Not Allowed" }));
app.get("/health", (_req, res) => res.json({ ok: true, org: Boolean(ORG_ID) }));

app.listen(PORT, () => {
  console.log(`DevInsight MCP server on :${PORT} (streamable-http at /mcp)`);
});
