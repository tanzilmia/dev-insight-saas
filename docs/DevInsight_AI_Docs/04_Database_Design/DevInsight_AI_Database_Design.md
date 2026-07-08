# Volume 4: Database Design

## Database Technology

- PostgreSQL
- Prisma ORM

## Design Goals

- Multi-tenant organization support
- Secure Git credential storage
- Repository and contributor tracking
- Employee to Git identity mapping
- Report history
- Statistics and audit logs

## Core Entities

### User
Represents a person using the platform.

Fields:
- id
- name
- email
- passwordHash
- status
- createdAt
- updatedAt

### Organization
Represents a company/team.

Fields:
- id
- name
- slug
- createdAt
- updatedAt

### OrganizationMember
Maps users to organizations and roles.

Fields:
- id
- organizationId
- userId
- role
- status

### Project
Represents a business/project workspace.

Fields:
- id
- organizationId
- name
- description
- status

### ProjectMember
Assigns employees to projects.

Fields:
- id
- projectId
- userId
- role

### GitCredential
Stores encrypted Git provider credentials.

Fields:
- id
- organizationId
- provider
- encryptedToken
- tokenLast4
- status
- lastValidatedAt
- createdById

Never store plain token.

### Repository
Represents a connected Git repository.

Fields:
- id
- organizationId
- projectId
- credentialId
- provider
- owner
- name
- fullName
- remoteUrl
- isPrivate
- externalId
- lastSyncedAt

### ContributorIdentity
Represents detected Git identity from commits or provider API.

Fields:
- id
- organizationId
- repositoryId
- provider
- username
- authorName
- authorEmail
- externalId
- ignored

### EmployeeGitMapping
Maps platform user to one or more Git identities.

Fields:
- id
- organizationId
- userId
- contributorIdentityId
- confidence
- isPrimary

### Commit
Stores commit metadata.

Fields:
- id
- repositoryId
- sha
- message
- authorName
- authorEmail
- username
- committedAt
- additions
- deletions
- changedFilesCount

### ChangedFile
Stores file-level changes.

Fields:
- id
- commitId
- filePath
- status
- additions
- deletions
- changes
- module
- category

### Report
Stores generated report.

Fields:
- id
- organizationId
- projectId
- repositoryId
- requestedById
- reportType
- periodStart
- periodEnd
- title
- markdownContent
- statisticsJson
- promptUsed
- status
- createdAt

### ReportContributor
Links reports to users/contributors.

Fields:
- id
- reportId
- userId
- contributorIdentityId
- commitCount
- summary

### ReportShare
Stores sharing actions.

Fields:
- id
- reportId
- sharedById
- channelType
- channelName
- status
- sharedAt

### TeamChannel
Future channel integrations.

Fields:
- id
- organizationId
- type
- name
- configJson
- status

### RequestLog
Logs user requests.

Fields:
- id
- organizationId
- userId
- source
- input
- status
- errorMessage
- createdAt

### AuditLog
Logs sensitive actions.

Fields:
- id
- organizationId
- actorId
- action
- entityType
- entityId
- metadataJson
- createdAt

## Prisma Schema Draft

```prisma
enum GitProvider {
  GITHUB
  GITLAB
  BITBUCKET
}

enum OrgRole {
  OWNER
  MANAGER
  EMPLOYEE
  ADMIN
}

enum ReportType {
  REPOSITORY
  EMPLOYEE
  TEAM
  MANAGER
  CEO
  RISK
}

model User {
  id        String   @id @default(cuid())
  name      String
  email     String   @unique
  passwordHash String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  memberships OrganizationMember[]
  projectMemberships ProjectMember[]
  gitMappings EmployeeGitMapping[]
  reportsRequested Report[] @relation("ReportsRequested")
}

model Organization {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members OrganizationMember[]
  projects Project[]
  credentials GitCredential[]
  repositories Repository[]
}

model OrganizationMember {
  id String @id @default(cuid())
  organizationId String
  userId String
  role OrgRole
  status String @default("ACTIVE")

  organization Organization @relation(fields: [organizationId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@unique([organizationId, userId])
}

model Project {
  id String @id @default(cuid())
  organizationId String
  name String
  description String?
  status String @default("ACTIVE")

  organization Organization @relation(fields: [organizationId], references: [id])
  members ProjectMember[]
  repositories Repository[]
}

model ProjectMember {
  id String @id @default(cuid())
  projectId String
  userId String
  role String @default("DEVELOPER")

  project Project @relation(fields: [projectId], references: [id])
  user User @relation(fields: [userId], references: [id])

  @@unique([projectId, userId])
}

model GitCredential {
  id String @id @default(cuid())
  organizationId String
  provider GitProvider
  encryptedToken String
  tokenLast4 String?
  status String @default("CONNECTED")
  lastValidatedAt DateTime?
  createdAt DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])
  repositories Repository[]
}

model Repository {
  id String @id @default(cuid())
  organizationId String
  projectId String?
  credentialId String
  provider GitProvider
  owner String
  name String
  fullName String
  remoteUrl String
  isPrivate Boolean @default(false)
  externalId String?
  lastSyncedAt DateTime?

  organization Organization @relation(fields: [organizationId], references: [id])
  project Project? @relation(fields: [projectId], references: [id])
  credential GitCredential @relation(fields: [credentialId], references: [id])
  identities ContributorIdentity[]
  commits Commit[]
}

model ContributorIdentity {
  id String @id @default(cuid())
  organizationId String
  repositoryId String
  provider GitProvider
  username String?
  authorName String?
  authorEmail String?
  externalId String?
  ignored Boolean @default(false)

  repository Repository @relation(fields: [repositoryId], references: [id])
  mappings EmployeeGitMapping[]
}

model EmployeeGitMapping {
  id String @id @default(cuid())
  organizationId String
  userId String
  contributorIdentityId String
  confidence Float?
  isPrimary Boolean @default(false)

  user User @relation(fields: [userId], references: [id])
  contributorIdentity ContributorIdentity @relation(fields: [contributorIdentityId], references: [id])

  @@unique([userId, contributorIdentityId])
}

model Commit {
  id String @id @default(cuid())
  repositoryId String
  sha String
  message String
  authorName String?
  authorEmail String?
  username String?
  committedAt DateTime
  additions Int @default(0)
  deletions Int @default(0)
  changedFilesCount Int @default(0)

  repository Repository @relation(fields: [repositoryId], references: [id])
  changedFiles ChangedFile[]

  @@unique([repositoryId, sha])
}

model ChangedFile {
  id String @id @default(cuid())
  commitId String
  filePath String
  status String?
  additions Int @default(0)
  deletions Int @default(0)
  changes Int @default(0)
  module String?
  category String?

  commit Commit @relation(fields: [commitId], references: [id])
}

model Report {
  id String @id @default(cuid())
  organizationId String
  projectId String?
  repositoryId String?
  requestedById String
  reportType ReportType
  periodStart DateTime
  periodEnd DateTime
  title String
  markdownContent String
  statisticsJson Json?
  promptUsed String?
  status String @default("COMPLETED")
  createdAt DateTime @default(now())

  requestedBy User @relation("ReportsRequested", fields: [requestedById], references: [id])
  contributors ReportContributor[]
  shares ReportShare[]
}

model ReportContributor {
  id String @id @default(cuid())
  reportId String
  userId String?
  contributorIdentityId String?
  commitCount Int @default(0)
  summary String?

  report Report @relation(fields: [reportId], references: [id])
}

model ReportShare {
  id String @id @default(cuid())
  reportId String
  sharedById String
  channelType String
  channelName String?
  status String
  sharedAt DateTime @default(now())

  report Report @relation(fields: [reportId], references: [id])
}
```

## Index Recommendations

- Repository: organizationId, provider, fullName
- Commit: repositoryId, committedAt
- ContributorIdentity: repositoryId, username, authorEmail
- Report: organizationId, createdAt, reportType

