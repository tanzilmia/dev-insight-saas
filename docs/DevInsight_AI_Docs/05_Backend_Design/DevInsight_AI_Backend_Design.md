# Volume 5: Backend Design

## Backend Goal

The backend is the secure data and tool layer used by the dashboard and OpenClaw.

The backend does not directly orchestrate AI report generation. OpenClaw is the orchestrator.

## Technology

- Node.js
- TypeScript
- Express or Nest-like modular Express architecture
- Prisma
- PostgreSQL
- Zod validation
- JWT auth
- Docker

## Folder Structure

```text
backend/
  src/
    main.ts
    app.ts
    config/
      env.ts
      database.ts
    common/
      errors/
      middleware/
      utils/
      validators/
      types/
    modules/
      auth/
      organizations/
      users/
      roles/
      projects/
      credentials/
      repositories/
      contributors/
      reports/
      statistics/
      git-providers/
      github/
      llm/
      openclaw/
      notifications/
    prisma/
      schema.prisma
```

## Module Responsibilities

### Auth Module
- Register
- Login
- Refresh token
- Password hashing
- Auth middleware

### Organization Module
- Create organization
- Manage organization settings
- List organization members

### Users Module
- Add employee
- Update employee
- Invite employee future
- Manage user status

### Roles Module
- Permission checks
- Role matrix

### Projects Module
- Create projects
- Assign employees
- Connect repositories

### Credentials Module
- Accept PAT
- Validate PAT
- Encrypt PAT
- Store encrypted PAT
- Reconnect credential
- Delete credential

### Git Provider Module
Common abstraction for GitHub, GitLab, Bitbucket.

```ts
export interface GitProvider {
  validateCredential(token: string): Promise<CredentialValidationResult>;
  listRepositories(token: string): Promise<GitRepository[]>;
  listContributors(input: ListContributorsInput): Promise<GitContributor[]>;
  listCommits(input: ListCommitsInput): Promise<GitCommit[]>;
  getCommitDetails(input: GetCommitDetailsInput): Promise<GitCommitDetail>;
}
```

### GitHub Module
- Implements GitProvider for GitHub.
- Uses GitHub REST API.
- Handles pagination and rate limits.

### Repositories Module
- Sync repositories
- Save selected repositories
- Track sync status

### Contributors Module
- Discover Git identities
- Show unmapped identities
- Map identities to employees
- Merge/ignore identities

### Reports Module
- Store reports
- Return report history
- Return report details
- Export placeholders

### Statistics Module
- Calculate commit stats
- Calculate project stats
- Calculate employee stats
- Calculate risk score

### LLM Module
- Provider abstraction
- Prompt builder
- Token chunking
- Report generation helper

### OpenClaw Module
- Exposes backend tools callable by OpenClaw.
- Validates OpenClaw requests.
- Provides tool contracts.

## API Design

### Auth
```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
```

### Organizations
```text
POST /api/organizations
GET /api/organizations/:id
GET /api/organizations/:id/members
```

### Projects
```text
POST /api/projects
GET /api/projects
GET /api/projects/:id
POST /api/projects/:id/members
POST /api/projects/:id/repositories
```

### Credentials
```text
POST /api/git-credentials
POST /api/git-credentials/:id/validate
PATCH /api/git-credentials/:id/reconnect
DELETE /api/git-credentials/:id
```

### Repositories
```text
POST /api/repositories/sync
GET /api/repositories
POST /api/repositories/select
POST /api/repositories/:id/resync
```

### Contributors
```text
GET /api/repositories/:id/contributors
GET /api/repositories/:id/contributors/unmapped
POST /api/contributors/map
POST /api/contributors/merge
POST /api/contributors/ignore
```

### Reports
Dashboard does not directly generate reports. It can read history.

```text
GET /api/reports
GET /api/reports/:id
GET /api/reports/:id/download
```

### OpenClaw Tool APIs
These APIs are called by OpenClaw.

```text
POST /api/openclaw/tools/generate-report
POST /api/openclaw/tools/resolve-project
POST /api/openclaw/tools/resolve-employee
POST /api/openclaw/tools/fetch-git-activity
POST /api/openclaw/tools/save-report
POST /api/openclaw/tools/share-report
```

## Security

### Token Encryption

Use AES-256-GCM.

Environment:
```text
GIT_TOKEN_ENCRYPTION_KEY=base64-encoded-32-byte-key
```

Never log tokens.
Never return token to frontend.

### Permission Check

Before every sensitive operation:
- Validate user session
- Validate organization membership
- Validate project access
- Validate role permission

## Error Handling

Use custom error classes:
- AppError
- ValidationError
- UnauthorizedError
- ForbiddenError
- NotFoundError
- GitProviderError
- LLMError
- OpenClawError

## Logging

Log:
- Request start/end
- User id
- Organization id
- Operation
- Error code
- Duration

Do not log:
- PAT
- LLM sensitive payloads
- Passwords

## Testing

Unit tests:
- URL parser
- Date resolver
- Credential encryption
- Permission checks
- Contributor mapping

Integration tests:
- Repository sync mock
- Report generation through OpenClaw tool API mock

