# Volume 1: Product Requirement Document (PRD)

## Product Name

DevInsight AI

## Product Vision

DevInsight AI is an AI-powered SaaS platform that helps engineering leaders understand developer activity, project progress, team productivity, and technical risk from Git activity without repeatedly asking employees for manual updates.

The platform converts Git repository activity into clear, role-specific reports and statistics.

## Target Users

### Owner / CEO
- Wants company-wide engineering visibility.
- Wants executive summaries.
- Wants project risk and progress insights.

### CTO / Engineering Head
- Wants technical risk analysis.
- Wants visibility across teams and repositories.
- Wants engineering health metrics.

### Manager / Team Lead
- Adds projects and employees.
- Maps employees to Git identities.
- Generates project, team, and developer reports.
- Shares reports with teams.

### Employee / Developer
- Generates personal daily/weekly/custom work reports.
- Views assigned projects.
- Shares own report if permitted.

## Problem Statement

Managers often ask developers:

- What did you work on today?
- Which project did you contribute to?
- What changed this week?
- Who worked on a specific module?
- What areas are risky before deployment?

Manual reporting wastes time and is often incomplete. Git history already contains useful signals, but it is hard for non-technical leaders to read and interpret.

DevInsight AI solves this by analyzing Git activity and generating intelligent reports automatically on demand.

## Product Goals

- Generate developer work reports from Git activity.
- Generate team and project reports.
- Provide statistics and insights for managers.
- Support employee self-reporting.
- Support report sharing.
- Use OpenClaw as the central AI orchestration layer.
- Start with GitHub PAT integration.
- Design for future GitLab and Bitbucket support.

## MVP Scope

### Included
- User authentication
- Organization setup
- Roles: Owner, Manager, Employee, Admin
- GitHub PAT connection
- PAT validation and encryption
- Repository sync
- Repository selection
- Contributor discovery
- Employee to Git identity mapping
- Generate reports by repository, employee, team, date range
- Report history
- Basic statistics
- OpenClaw orchestration for all report generation
- Next.js dashboard
- PostgreSQL + Prisma
- Docker setup

### Not Included in MVP
- GitHub App installation flow
- GitLab integration
- Bitbucket integration
- Jira integration
- PDF export
- Billing
- Mobile app
- Enterprise SSO

## User Stories

### Manager
- As a manager, I want to connect my GitHub account using PAT so that I can import repositories.
- As a manager, I want to select repositories so that only relevant projects are tracked.
- As a manager, I want to add employees so that I can assign them to projects.
- As a manager, I want to map Git authors to employees so that reports are accurate.
- As a manager, I want to generate reports for an employee so that I can understand their work.
- As a manager, I want to generate a project report so that I can understand progress.
- As a manager, I want to view statistics so that I can make better decisions.

### Employee
- As an employee, I want to view my assigned projects.
- As an employee, I want to generate my own work report.
- As an employee, I want to share my report with my team if allowed.

### Owner / CEO
- As a CEO, I want to view high-level engineering summaries.
- As a CEO, I want to know which projects are active or risky.

## Key Workflows

### Manager Setup Flow

1. Manager creates organization.
2. Manager adds GitHub PAT.
3. Backend validates PAT.
4. Backend encrypts PAT.
5. System syncs repositories.
6. Manager selects repositories.
7. System discovers contributors.
8. Manager adds employees.
9. Manager maps Git identities to employees.
10. Manager generates reports.

### Employee Report Flow

1. Employee logs in.
2. Employee selects assigned project.
3. Employee selects period.
4. Request goes to OpenClaw.
5. OpenClaw calls backend tools.
6. Backend fetches Git data.
7. LLM analyzes activity.
8. Report is saved.
9. Report is returned to dashboard.

## Success Metrics

- Time saved on daily reporting.
- Number of reports generated per week.
- Number of repositories connected.
- Accuracy of employee mapping.
- Manager engagement with statistics dashboard.
- Report sharing frequency.

## Product Positioning

DevInsight AI is not only a GitHub report generator. It is a Developer Intelligence Platform.

Future integrations may include:
- GitLab
- Bitbucket
- Jira
- Linear
- Azure DevOps
- Slack
- Discord
- Telegram
