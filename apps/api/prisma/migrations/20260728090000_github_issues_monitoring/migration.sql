-- CreateTable
CREATE TABLE "GitHubIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "state" TEXT NOT NULL,
    "stateReason" TEXT,
    "authorLogin" TEXT,
    "authorAvatarUrl" TEXT,
    "assigneeLogins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "milestoneTitle" TEXT,
    "htmlUrl" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "providerUpdatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GitHubIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubIssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorLogin" TEXT,
    "assigneeLogin" TEXT,
    "labelName" TEXT,
    "milestoneTitle" TEXT,
    "commitSha" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubIssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubIssue_repositoryId_number_key" ON "GitHubIssue"("repositoryId", "number");
CREATE UNIQUE INDEX "GitHubIssue_repositoryId_externalId_key" ON "GitHubIssue"("repositoryId", "externalId");
CREATE INDEX "GitHubIssue_organizationId_state_idx" ON "GitHubIssue"("organizationId", "state");
CREATE INDEX "GitHubIssue_repositoryId_openedAt_idx" ON "GitHubIssue"("repositoryId", "openedAt");
CREATE INDEX "GitHubIssue_repositoryId_authorLogin_idx" ON "GitHubIssue"("repositoryId", "authorLogin");
CREATE UNIQUE INDEX "GitHubIssueEvent_issueId_externalId_key" ON "GitHubIssueEvent"("issueId", "externalId");
CREATE INDEX "GitHubIssueEvent_issueId_occurredAt_idx" ON "GitHubIssueEvent"("issueId", "occurredAt");
CREATE INDEX "GitHubIssueEvent_actorLogin_idx" ON "GitHubIssueEvent"("actorLogin");

-- AddForeignKey
ALTER TABLE "GitHubIssue" ADD CONSTRAINT "GitHubIssue_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubIssue" ADD CONSTRAINT "GitHubIssue_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubIssueEvent" ADD CONSTRAINT "GitHubIssueEvent_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "GitHubIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
