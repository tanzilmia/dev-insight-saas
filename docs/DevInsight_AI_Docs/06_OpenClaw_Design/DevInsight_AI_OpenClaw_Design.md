# Volume 6: OpenClaw Design

## OpenClaw Role

OpenClaw is the AI orchestration layer of DevInsight AI.

Every report generation request must go through OpenClaw.

## Why OpenClaw Is Needed

OpenClaw provides:
- Natural language command handling
- Agent reasoning
- Tool orchestration
- Multi-channel support
- Unified AI workflow layer

## Core Rule

```text
Dashboard Report Request -> OpenClaw -> Backend Tool -> Report
Chat Report Request -> OpenClaw -> Backend Tool -> Report
```

No direct dashboard-to-report-generation path.

## OpenClaw Agent Responsibilities

- Parse user intent
- Identify report type
- Resolve project/repository
- Resolve employee/contributor
- Resolve date range
- Validate permissions through backend
- Call backend Git/report tools
- Build LLM analysis request
- Return Markdown report
- Save report through backend
- Share report if requested

## Tool Design

### Tool: generate_report
Input:
```json
{
  "organizationId": "org_123",
  "requesterId": "user_123",
  "source": "dashboard|slack|telegram|discord",
  "repositoryId": "repo_123",
  "projectId": "project_123",
  "employeeIds": ["user_456"],
  "period": "last_7_days",
  "customDateRange": {
    "from": "2026-01-01",
    "to": "2026-01-07"
  },
  "reportType": "employee|repository|team|manager|ceo|risk",
  "customPrompt": "optional"
}
```

Output:
```json
{
  "reportId": "report_123",
  "title": "Rahim's Last 7 Days Report",
  "markdown": "# Report...",
  "statistics": {},
  "status": "completed"
}
```

### Tool: resolve_project
Purpose:
Find project/repository from natural language.

### Tool: resolve_employee
Purpose:
Find employee from name, username, or email.

### Tool: fetch_git_activity
Purpose:
Fetch normalized Git activity from backend.

### Tool: save_report
Purpose:
Persist report and statistics.

### Tool: share_report
Purpose:
Share report to team/group/channel.

## Natural Language Examples

- Generate today's report for Project A.
- What did Rahim work on today?
- Generate last 7 days report for john and sarah.
- Who worked on authentication this week?
- Which project has the highest risk this week?
- Generate my today report and send it to the team group.

## Dashboard Request Handling

Dashboard form submits structured payload to OpenClaw.

OpenClaw treats it as a structured intent, not just plain chat.

```text
Dashboard Form -> OpenClaw Structured Request -> Backend Tool -> Report
```

## Chat Request Handling

Chat message is parsed by OpenClaw.

```text
Chat Text -> Intent Parser -> Entity Resolver -> Tool Calls -> Report
```

## Prompt Strategy

OpenClaw should use a report prompt builder.

Prompt sections:
- Role
- Report type
- Date range
- Repository context
- Contributor context
- Commit summary
- File changes
- Statistics
- Required output format

## Token Optimization

If there are many commits:
1. Summarize commits in chunks.
2. Summarize chunk summaries.
3. Generate final report.

Do not send unnecessary sensitive data to LLM.

## OpenClaw Integration Phases

Phase 1:
- Define tools
- Connect OpenClaw to backend APIs

Phase 2:
- Dashboard structured request to OpenClaw

Phase 3:
- Natural language chat commands

Phase 4:
- Slack/Telegram/Discord channels

## Failure Handling

OpenClaw should return friendly errors:
- Repository not found
- Employee not mapped
- No commits found
- Permission denied
- Git provider error
- LLM error

