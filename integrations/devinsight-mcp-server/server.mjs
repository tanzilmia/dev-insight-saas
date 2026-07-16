import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const DEFAULT_DEVINSIGHT_URL = "http://localhost:4000";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4100;
const UPSTREAM_TIMEOUT_MS = 30_000;

function safeEqual(a, b) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

export function readConfig(source = process.env) {
  const serviceKey = source.DEVINSIGHT_SERVICE_KEY?.trim() ?? "";
  const mcpAccessToken = source.MCP_ACCESS_TOKEN?.trim() ?? "";
  const host = source.MCP_HOST?.trim() || DEFAULT_HOST;
  const port = Number(source.PORT ?? DEFAULT_PORT);

  if (!serviceKey) {
    throw new Error("DEVINSIGHT_SERVICE_KEY is required");
  }
  if (!mcpAccessToken) {
    throw new Error("MCP_ACCESS_TOKEN is required");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }

  return {
    devInsightUrl: source.DEVINSIGHT_URL?.trim() || DEFAULT_DEVINSIGHT_URL,
    serviceKey,
    mcpAccessToken,
    host,
    port
  };
}

export function requireMcpBearer(expectedToken) {
  return (req, res, next) => {
    const authorization = req.header("authorization");
    const provided = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";

    if (!provided || !safeEqual(provided, expectedToken)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

async function callDevInsight(config, contextToken, path, init = {}) {
  const response = await fetch(`${config.devInsightUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-openclaw-key": config.serviceKey,
      "x-openclaw-context": contextToken
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`DevInsight request failed (${response.status}): ${detail}`);
  }
  return response.json();
}

function buildServer(config) {
  const server = new McpServer({ name: "devinsight", version: "0.2.0" });

  server.tool(
    "devinsight_context",
    "List the authorized DevInsight organization's tracked repositories, projects, and employees. Pass the opaque contextToken from DevInsight unchanged.",
    { contextToken: z.string().min(1) },
    async ({ contextToken }) => {
      const data = await callDevInsight(
        config,
        contextToken,
        "/api/openclaw/tools/context"
      );
      return { content: [{ type: "text", text: JSON.stringify(data.context) }] };
    }
  );

  server.tool(
    "devinsight_generate_report",
    "Generate a developer work report from real Git activity. Pass the opaque contextToken from DevInsight unchanged. Resolve ids via devinsight_context first when the user gives names.",
    {
      contextToken: z.string().min(1),
      reportType: z.enum(["repository", "project", "employee", "team"]),
      repositoryId: z.string().optional(),
      projectId: z.string().optional(),
      employeeIds: z.array(z.string()).optional(),
      period: z
        .enum([
          "today",
          "yesterday",
          "last_7_days",
          "last_30_days",
          "last_90_days",
          "this_month",
          "last_month",
          "custom"
        ])
        .optional(),
      customRange: z.object({ from: z.string(), to: z.string() }).optional(),
      branch: z.string().optional()
    },
    async (args) => {
      const data = await callDevInsight(
        config,
        args.contextToken,
        "/api/openclaw/tools/generate-report",
        {
          method: "POST",
          body: {
            period: args.period ?? "last_7_days",
            customRange: args.customRange,
            reportType: args.reportType,
            repositoryId: args.repositoryId,
            projectId: args.projectId,
            employeeIds: args.employeeIds,
            branch: args.branch
          }
        }
      );
      return {
        content: [{ type: "text", text: data.report?.markdown ?? "No report produced." }]
      };
    }
  );

  return server;
}

export function createMcpApp(config) {
  const app = express();
  const authenticate = requireMcpBearer(config.mcpAccessToken);
  const parseJson = express.json({ limit: "256kb" });

  app.post("/mcp", authenticate, parseJson, async (req, res) => {
    const server = buildServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: "MCP request failed" });
      }
    }
  });

  app.get("/mcp", (_req, res) =>
    res.status(405).json({ error: "Method Not Allowed" })
  );
  app.get("/health", (_req, res) => res.json({ ok: true }));

  return app;
}

export function startMcpServer(config = readConfig()) {
  return createMcpApp(config).listen(config.port, config.host, () => {
    console.log(`DevInsight MCP server listening on ${config.host}:${config.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcpServer();
}
