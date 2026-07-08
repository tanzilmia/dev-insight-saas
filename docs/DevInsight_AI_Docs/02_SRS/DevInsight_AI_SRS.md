# Volume 2: Software Requirement Specification (SRS)

## 1. Introduction

DevInsight AI is a SaaS platform that analyzes Git activity and generates AI-powered reports and statistics for engineering teams.

## 2. Functional Requirements

### Authentication
- Users can register and log in.
- Users belong to organizations.
- Users have roles and permissions.

### Organization Management
- Owner can create organization.
- Owner can invite/add users.
- Organization contains projects, employees, repositories, credentials, reports.

### Role Management
Supported roles:
- Owner / CEO
- Manager / Team Lead
- Employee / Developer
- Admin

### Project Management
- Manager can create projects.
- Manager can connect repositories to projects.
- Manager can assign employees to projects.

### Git Credential Management
- Manager can add GitHub PAT.
- Backend validates PAT.
- Backend encrypts PAT before storing.
- Token is never shown again.
- Manager can reconnect/replace token.
- Credential status is tracked.

### Repository Sync
- System fetches repositories accessible by PAT.
- Manager selects repositories to manage.
- System stores selected repository metadata.
- Manual sync is supported.

### Contributor Discovery
- System fetches repository contributors.
- System fetches commit authors from history.
- System stores Git identities separately from platform users.

### Employee to Git Identity Mapping
- Manager maps one or more Git identities to one employee.
- Mapping supports username, author name, and email.
- Unmapped contributors are visible.
- Duplicate identities can be merged.
- Identities can be ignored.

### Report Generation
All report generation must go through OpenClaw.

Report inputs:
- Repository
- Employee/contributor optional
- Multiple employees optional
- Period
- Report template
- Custom prompt optional

Supported periods:
- Today
- Yesterday
- Today and Yesterday
- Last 7 Days
- Last 30 Days
- Custom date range

### Report Types
- Repository Report
- Employee Report
- Multi-contributor Report
- Team Report
- Manager Report
- CEO Summary
- Risk Report

### Statistics
System calculates:
- Total commits
- Commits by employee
- Commits by project
- Active days
- Files changed
- Lines added/deleted
- Most changed files
- Most changed modules
- Feature/bug/refactor ratio
- Risk score

### Report Sharing
- Users can share reports if permitted.
- MVP stores share action.
- Future supports Slack, Telegram, Discord, Email.

## 3. Non-functional Requirements

### Security
- PAT encrypted at rest.
- Secrets stored in .env.
- PAT never sent to frontend after saving.
- Role-based access control.
- Audit logs.

### Scalability
- Modular backend.
- Provider abstraction for GitHub, GitLab, Bitbucket.
- Chunked LLM processing for large commit sets.

### Maintainability
- TypeScript strict mode.
- SOLID principles.
- Prisma ORM.
- Clean modular architecture.

### Reliability
- Handle API failures.
- Handle GitHub rate limits.
- Handle LLM failures.
- Store request logs.

## 4. Edge Cases

- Invalid Git URL
- Invalid PAT
- Expired PAT
- Private repo without permission
- No commits in date range
- Contributor not mapped
- Same employee has multiple Git identities
- Multiple employees share same commit email accidentally
- Large commit history exceeds LLM token limit
- GitHub API rate limit
- Database failure
- OpenClaw failure

## 5. Permission Matrix

| Feature | Owner | Manager | Employee | Admin |
|---|---|---|---|---|
| Create organization | Yes | No | No | Yes |
| Add Git credential | Yes | Yes | No | Yes |
| Add project | Yes | Yes | No | Yes |
| Add employee | Yes | Yes | No | Yes |
| Map Git identity | Yes | Yes | No | Yes |
| Generate own report | Yes | Yes | Yes | Yes |
| Generate team report | Yes | Yes | No | Yes |
| View all reports | Yes | Yes | No | Yes |
| View own reports | Yes | Yes | Yes | Yes |
| View statistics | Yes | Yes | Limited | Yes |
| Share report | Yes | Yes | If allowed | Yes |

## 6. OpenClaw Requirement

OpenClaw is the single orchestration layer for AI report generation.

Dashboard must send report generation requests to OpenClaw, not directly to report services.

