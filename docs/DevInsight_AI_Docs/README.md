# DevInsight AI Documentation Pack

DevInsight AI is an AI-powered Developer Intelligence and Team Work Report Platform.

This documentation pack is designed to help Codex, Claude, Cursor, or any AI coding assistant understand the product vision, requirements, architecture, and implementation roadmap.

## Volumes

1. Product Requirement Document (PRD)
2. Software Requirement Specification (SRS)
3. System Architecture
4. Database Design
5. Backend Design
6. OpenClaw Design
7. Frontend Design
8. Development Roadmap

## Core Architecture Rule

Every report generation request must go through OpenClaw.

Dashboard / Chat / API Client -> OpenClaw -> Backend Tools/APIs -> Git Provider -> LLM -> PostgreSQL -> OpenClaw -> Response

## MVP Focus

- Authentication
- Organization and role management
- GitHub PAT integration
- Repository sync
- Contributor discovery
- Employee to Git identity mapping
- OpenClaw orchestration
- AI report generation
- Report history
- Basic statistics
