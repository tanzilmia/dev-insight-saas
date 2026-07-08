# Volume 8: Development Roadmap

## Development Strategy

Build DevInsight AI phase by phase. Do not build everything at once.

Start with a production-ready MVP, then expand.

## Phase 0: Preparation

Deliverables:
- Repository setup
- Monorepo or separate frontend/backend decision
- Docker setup skeleton
- Environment configuration
- Coding standards

Recommended structure:

```text
devinsight-ai/
  apps/
    web/
    api/
  packages/
    shared/
  docs/
```

## Phase 1: Core Backend Foundation

Deliverables:
- Express app
- TypeScript strict mode
- Config module
- Logger
- Error handling
- Prisma setup
- PostgreSQL Docker service

## Phase 2: Authentication and Organization

Deliverables:
- Register/login
- JWT auth
- Organization creation
- Organization membership
- Role support

## Phase 3: Project and Employee Management

Deliverables:
- Project CRUD
- Employee CRUD
- Project assignment
- Role and permission checks

## Phase 4: Git Credential Management

Deliverables:
- PAT submit API
- GitHub credential validation
- AES encryption
- Save encrypted token
- Token status UI

## Phase 5: Repository Sync

Deliverables:
- Git provider interface
- GitHub provider implementation
- Repository list fetch
- Repository selection
- Repository persistence

## Phase 6: Contributor Discovery and Mapping

Deliverables:
- Fetch contributors
- Fetch commit authors
- Store ContributorIdentity
- Map identities to employees
- Show unmapped identities
- Merge/ignore support

## Phase 7: OpenClaw Tool Integration

Deliverables:
- Define OpenClaw tools
- Backend tool endpoints
- Structured dashboard request to OpenClaw
- OpenClaw calls backend tools

## Phase 8: Git Activity Collection

Deliverables:
- Fetch commits by date range
- Fetch commit details
- Fetch changed files
- Handle pagination
- Normalize commit data

## Phase 9: Report Engine

Deliverables:
- Date range resolver
- Contributor filter
- Commit classifier
- Statistics builder
- Risk detector

## Phase 10: LLM Integration

Deliverables:
- LLM provider abstraction
- Prompt builder
- Report templates
- Chunking strategy
- Markdown report generation

## Phase 11: Report Persistence and History

Deliverables:
- Save report
- Save report contributors
- Save statistics JSON
- Report history API
- Report detail API

## Phase 12: Frontend Dashboard MVP

Deliverables:
- Login/register
- Organization setup
- Projects
- Git credentials
- Repository sync
- Employee management
- Contributor mapping
- Generate report
- Report result
- Report history

## Phase 13: Statistics Dashboard

Deliverables:
- Project statistics
- Employee statistics
- Team statistics
- Basic charts
- Risk summary

## Phase 14: Sharing MVP

Deliverables:
- Share report action
- Store share logs
- Placeholder for Slack/Telegram/Discord

## Phase 15: Testing

Deliverables:
- Unit tests
- Integration tests
- Mock GitHub API tests
- OpenClaw tool tests

## Phase 16: Deployment

Deliverables:
- Dockerfile frontend
- Dockerfile backend
- docker-compose.yml
- Production env guide
- Migration guide

## MVP Definition of Done

The MVP is complete when:

- Manager can create org.
- Manager can add encrypted GitHub PAT.
- Manager can sync repositories.
- Manager can select repository.
- Manager can add employees.
- Manager can map Git identities.
- Manager can generate report through OpenClaw.
- Employee can generate own report through OpenClaw.
- Reports are saved and visible in history.
- Basic statistics are visible.

## Future Roadmap

### V2
- GitHub App integration
- Better onboarding wizard
- Slack sharing
- PDF export

### V3
- GitLab support
- Bitbucket support
- Multi-repo reports
- Advanced risk scoring

### V4
- Jira integration
- Sprint analytics
- Ticket-to-commit correlation
- Executive dashboard

### V5
- Billing
- Team plans
- Enterprise SSO
- Audit compliance

## AI Coding Assistant Instructions

When using Claude, Codex, Cursor, or Copilot:

1. Read all docs first.
2. Do not generate full project at once.
3. Implement phase by phase.
4. After each phase, run tests.
5. Keep OpenClaw as the report orchestration layer.
6. Keep Git provider abstraction.
7. Keep PAT encrypted.
8. Do not bypass employee to Git identity mapping.

