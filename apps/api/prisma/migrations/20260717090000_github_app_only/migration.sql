-- GitHub App is now the only repository access mechanism. This migration is
-- intentionally destructive: repositories without a matching active App grant
-- and their local domain data are permanently removed.
BEGIN;

CREATE TEMP TABLE "_DoomedRepository" ON COMMIT DROP AS
SELECT
  r."id",
  r."organizationId",
  r."sonarProjectKey"
FROM "Repository" r
WHERE r."appInstallationId" IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM "RepositoryAccess" ra
     JOIN "GitHubAppInstallation" gai ON gai."id" = ra."appInstallationId"
     WHERE ra."repositoryId" = r."id"
       AND ra."appInstallationId" = r."appInstallationId"
       AND gai."organizationId" = r."organizationId"
   );

-- These repository references are intentionally loose (no FK), so clean them
-- before Repository's relational cascades run.
DELETE FROM "Report"
WHERE "repositoryId" IN (SELECT "id" FROM "_DoomedRepository");

DELETE FROM "ReportSchedule"
WHERE "repositoryId" IN (SELECT "id" FROM "_DoomedRepository");

DELETE FROM "CodeQualitySnapshot" snapshot
USING "_DoomedRepository" doomed
WHERE doomed."sonarProjectKey" IS NOT NULL
  AND snapshot."organizationId" = doomed."organizationId"
  AND snapshot."projectKey" = doomed."sonarProjectKey";

DELETE FROM "AuditLog"
WHERE "entityId" IN (SELECT "id" FROM "_DoomedRepository")
   OR "metadataJson" ->> 'repositoryId' IN (SELECT "id" FROM "_DoomedRepository");

-- Commits, branches, contributors, coverage, collection jobs, PRs, CI rows,
-- workflow runs, and RepositoryAccess rows cascade from Repository.
DELETE FROM "Repository"
WHERE "id" IN (SELECT "id" FROM "_DoomedRepository");

ALTER TABLE "Repository" DROP CONSTRAINT "Repository_credentialId_fkey";
ALTER TABLE "Repository" DROP CONSTRAINT "Repository_appInstallationId_fkey";

DROP INDEX "Repository_credentialId_idx";

ALTER TABLE "Repository"
  DROP COLUMN "credentialId",
  DROP COLUMN "webhookExternalId",
  DROP COLUMN "webhookSecret",
  ALTER COLUMN "appInstallationId" SET NOT NULL;

ALTER TABLE "Repository"
  ADD CONSTRAINT "Repository_appInstallationId_fkey"
  FOREIGN KEY ("appInstallationId") REFERENCES "GitHubAppInstallation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE "GitCredential";
DROP TYPE "CredentialStatus";

COMMIT;
