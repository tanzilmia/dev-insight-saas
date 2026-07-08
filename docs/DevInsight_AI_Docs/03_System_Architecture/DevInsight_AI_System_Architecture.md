# Volume 3: System Architecture

## Architecture Goal

DevInsight AI must be modular, scalable, and OpenClaw-centered. Every report generation request must pass through OpenClaw.

## High-Level Architecture

```text
+--------------------+       +--------------------+
| Next.js Dashboard  |       | Chat Channels      |
| Web UI             |       | Slack/Telegram/etc |
+---------+----------+       +----------+---------+
          |                             |
          +-------------+---------------+
                        |
                        v
                 +-------------+
                 |  OpenClaw   |
                 | AI Agent    |
                 +------+------+ 
                        |
                        v
              +-------------------+
              | Backend Tools/API |
              +---------+---------+
                        |
      +-----------------+------------------+
      |                 |                  |
      v                 v                  v
+-------------+   +-------------+   +-------------+
| Git Provider|   | PostgreSQL  |   | LLM Provider|
| GitHub MVP  |   | Prisma ORM  |   | OpenAI/etc  |
+-------------+   +-------------+   +-------------+
```

## Core Rule

The dashboard must not directly generate reports.

Correct:

```text
Dashboard -> OpenClaw -> Backend -> Git Provider -> LLM -> DB -> OpenClaw -> Dashboard
```

Incorrect:

```text
Dashboard -> Backend Report Service -> LLM
```

## Main Components

### Next.js Dashboard
Responsible for:
- Authentication UI
- Organization management
- Project management
- Employee management
- Credential setup
- Repository sync UI
- Contributor mapping UI
- Report form
- Report history
- Statistics display

### OpenClaw
Responsible for:
- Intent parsing
- Request orchestration
- Calling backend tools
- Handling natural language requests
- Coordinating report generation
- Returning responses to original channel

### Backend API/Tools
Responsible for:
- Auth and permissions
- Secure credential storage
- Git provider access
- Repository sync
- Contributor sync
- Persistence
- Statistics
- APIs used by dashboard and OpenClaw

### Git Provider Layer
Provider abstraction:
- GitHubProvider MVP
- GitLabProvider future
- BitbucketProvider future

### LLM Layer
Provider abstraction:
- OpenAI-compatible API
- Claude
- OpenRouter
- Future local models

### PostgreSQL
Stores:
- Users
- Organizations
- Projects
- Credentials
- Repositories
- Contributors
- Mappings
- Commits
- Reports
- Statistics
- Logs

## Request Lifecycle

### Dashboard Report Request

```text
User selects repository + employee + date range
Dashboard sends request to OpenClaw
OpenClaw validates intent
OpenClaw calls backend report tool
Backend checks permissions
Backend resolves repository and employee mapping
Backend decrypts PAT
Backend fetches Git commits
Backend normalizes commit data
OpenClaw coordinates LLM analysis
Report is saved in PostgreSQL
Statistics are saved
OpenClaw returns Markdown report to dashboard
```

### Chat Report Request

```text
Manager writes: What did Rahim work on today?
OpenClaw parses intent
OpenClaw identifies organization, employee, period
OpenClaw calls backend tools
Backend fetches data
LLM generates answer
OpenClaw replies in chat
```

## Data Flow

```text
PAT -> Encrypt -> Database
Repository Sync -> Repository Metadata -> Database
Commit Data -> Normalize -> Analyze -> Report
Report -> Save -> Return
```

## Provider Abstraction

Report engine must depend on a common interface, not GitHub directly.

```ts
interface GitProvider {
  validateCredential(token: string): Promise<boolean>;
  listRepositories(token: string): Promise<RepositoryDto[]>;
  getContributors(repo: RepositoryRef): Promise<ContributorDto[]>;
  getCommits(input: CommitQuery): Promise<CommitDto[]>;
  getCommitDetails(input: CommitDetailQuery): Promise<CommitDetailDto>;
}
```

## Deployment Architecture

MVP Docker services:
- frontend
- backend
- postgres
- openclaw integration service if needed

Future:
- Redis queue
- worker service
- observability stack

