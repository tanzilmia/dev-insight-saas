import { Type } from "typebox";
// NOTE: verify this import path against your installed OpenClaw version.
// Per docs.openclaw.ai/plugins/tool-plugins the SDK barrel is `openclaw/plugin-sdk/*`.
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

type DevInsightConfig = {
  serviceUrl: string;
  apiKey: string;
};

async function callDevInsight(
  config: DevInsightConfig,
  contextToken: string,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const response = await fetch(`${config.serviceUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      "x-openclaw-key": config.apiKey,
      "x-openclaw-context": contextToken
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`DevInsight request failed (${response.status}): ${detail}`);
  }

  return response.json();
}

export default defineToolPlugin({
  id: "devinsight",
  name: "DevInsight",
  description: "Generate developer work reports from DevInsight (Git activity).",
  configSchema: Type.Object({
    serviceUrl: Type.String({
      description:
        "DevInsight API base URL. Inside the OpenClaw container use http://host.docker.internal:4000"
    }),
    apiKey: Type.String({ description: "DevInsight OPENCLAW_SERVICE_KEY" })
  }),
  tools: (tool) => [
    tool({
      name: "devinsight_context",
      label: "List DevInsight repos / projects / employees",
      description:
        "List the organization's tracked repositories, projects, and employees (id + name) so you can resolve the names in a request to ids before generating a report.",
      parameters: Type.Object({
        contextToken: Type.String({
          description: "Opaque context token supplied by the DevInsight chat system message."
        })
      }),
      async execute(
        params: { contextToken: string },
        config: DevInsightConfig
      ) {
        const data = (await callDevInsight(
          config,
          params.contextToken,
          "/api/openclaw/tools/context"
        )) as { context: unknown };
        return JSON.stringify(data.context);
      }
    }),
    tool({
      name: "devinsight_generate_report",
      label: "Generate DevInsight report",
      description:
        "Generate a developer work report for a repository, project, employee, or team over a period. Resolve ids with devinsight_context first if the user gave names. Returns Markdown.",
      parameters: Type.Object({
        contextToken: Type.String({
          description: "Opaque context token supplied by the DevInsight chat system message."
        }),
        reportType: Type.Union(
          [
            Type.Literal("repository"),
            Type.Literal("project"),
            Type.Literal("employee"),
            Type.Literal("team")
          ],
          { description: "The kind of report to produce." }
        ),
        repositoryId: Type.Optional(
          Type.String({ description: "Required for reportType=repository." })
        ),
        projectId: Type.Optional(
          Type.String({ description: "Required for reportType=project." })
        ),
        employeeIds: Type.Optional(
          Type.Array(Type.String(), {
            description: "Required for reportType=employee or team."
          })
        ),
        period: Type.Optional(
          Type.Union(
            [
              Type.Literal("today"),
              Type.Literal("last_7_days"),
              Type.Literal("last_30_days")
            ],
            { description: "Defaults to last_7_days." }
          )
        )
      }),
      async execute(
        params: {
          contextToken: string;
          reportType: "repository" | "project" | "employee" | "team";
          repositoryId?: string;
          projectId?: string;
          employeeIds?: string[];
          period?: "today" | "last_7_days" | "last_30_days";
        },
        config: DevInsightConfig
      ) {
        const data = (await callDevInsight(
          config,
          params.contextToken,
          "/api/openclaw/tools/generate-report",
          {
            method: "POST",
            body: {
              period: params.period ?? "last_7_days",
              reportType: params.reportType,
              repositoryId: params.repositoryId,
              projectId: params.projectId,
              employeeIds: params.employeeIds
            }
          }
        )) as { report?: { markdown?: string } };

        return data.report?.markdown ?? "No report was produced.";
      }
    })
  ]
});
