---
name: devinsight-reports
description: Generate developer work reports from DevInsight when the user asks about repository, team, or employee Git activity, "what was shipped", or a daily/weekly/monthly work report.
---

# DevInsight Reports

Use the DevInsight tools whenever the user asks about developer activity — a work
report, "what did we ship", "what did <person> do", a daily/weekly/monthly summary,
or which repo/team/person was active.

## Steps
1. **Resolve names → ids.** If the user names a repository, project, or employee, first
   call `devinsight_context` to list the org's tracked repositories, projects, and
   employees (each with an `id`). Match the user's words to the right `id`. If nothing
   matches, tell the user what is available.
2. **Generate the report.** Call `devinsight_generate_report`:
   - Pick `reportType`: a repo → `repository` (+ `repositoryId`); a project → `project`
     (+ `projectId`); one or more people → `employee`/`team` (+ `employeeIds`).
   - Map the period words: "today" → `today`; "this week"/"last week" → `last_7_days`;
     "this month" → `last_30_days`. Default to `last_7_days` if unspecified.
3. **Return the report.** Relay the returned Markdown to the user as-is. Never invent
   numbers or work. If the report says there is no activity, say so plainly and suggest
   collecting commits or widening the period.

## Examples
- "give me this week's report for the backend repo" → `devinsight_context` → find the
  backend repo id → `devinsight_generate_report(reportType=repository, repositoryId=…, period=last_7_days)`.
- "what did the team do this month?" → `devinsight_generate_report(reportType=team, employeeIds=[…], period=last_30_days)`.
- "summarize Rahim's work today" → context → find Rahim's employee id →
  `devinsight_generate_report(reportType=employee, employeeIds=[…], period=today)`.

## Guardrails
- Only report on the DevInsight organization the tools are configured for.
- Do not fabricate data; the tools return real Git-derived reports.
