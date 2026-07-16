import { readdir, readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TARGET = "20260717090000_github_app_only";
const migrationsRoot = new URL("../../prisma/migrations/", import.meta.url);

const db = new PGlite();

async function applyMigration(name: string) {
  const sql = await readFile(new URL(`${name}/migration.sql`, migrationsRoot), "utf8");
  await db.exec(sql);
}

async function scalar(sql: string): Promise<number> {
  const result = await db.query<{ count: number }>(sql);
  return Number(result.rows[0]?.count ?? 0);
}

describe.sequential("GitHub App-only destructive migration", () => {
  beforeAll(async () => {
    const migrations = (await readdir(migrationsRoot))
      .filter((name) => /^\d/.test(name) && name < TARGET)
      .sort();
    for (const migration of migrations) await applyMigration(migration);

    await db.exec(`
      INSERT INTO "User" ("id", "email", "passwordHash", "name", "updatedAt")
      VALUES ('user_1', 'owner@example.com', 'hash', 'Owner', NOW());
      INSERT INTO "Organization" ("id", "name", "slug", "updatedAt")
      VALUES ('org_1', 'Org', 'org', NOW());
      INSERT INTO "OrganizationMember" ("id", "organizationId", "userId", "role", "updatedAt")
      VALUES ('member_1', 'org_1', 'user_1', 'OWNER', NOW());

      INSERT INTO "GitCredential"
        ("id", "organizationId", "provider", "encryptedToken", "tokenLast4", "createdById", "updatedAt")
      VALUES ('cred_1', 'org_1', 'GITHUB', 'cipher', '1234', 'user_1', NOW());

      INSERT INTO "GitHubAppInstallation"
        ("id", "organizationId", "installationId", "accountLogin", "createdById", "updatedAt")
      VALUES ('install_1', 'org_1', '9001', 'softathena', 'user_1', NOW());

      INSERT INTO "Repository"
        ("id", "organizationId", "credentialId", "appInstallationId", "provider", "externalId",
         "owner", "name", "fullName", "remoteUrl", "sonarProjectKey", "updatedAt")
      VALUES
        ('repo_app', 'org_1', NULL, 'install_1', 'GITHUB', '7001',
         'softathena', 'app', 'softathena/app', 'https://github.com/softathena/app', 'sonar_app', NOW()),
        ('repo_pat', 'org_1', 'cred_1', NULL, 'GITHUB', '7002',
         'softathena', 'legacy', 'softathena/legacy', 'https://github.com/softathena/legacy', 'sonar_pat', NOW()),
        ('repo_orphan', 'org_1', NULL, 'install_1', 'GITHUB', '7003',
         'softathena', 'orphan', 'softathena/orphan', 'https://github.com/softathena/orphan', NULL, NOW());

      INSERT INTO "RepositoryAccess" ("id", "appInstallationId", "repositoryId")
      VALUES ('access_1', 'install_1', 'repo_app');

      INSERT INTO "Commit" ("id", "repositoryId", "sha", "message", "committedAt")
      VALUES
        ('commit_app', 'repo_app', 'sha_app', 'keep', NOW()),
        ('commit_pat', 'repo_pat', 'sha_pat', 'delete', NOW()),
        ('commit_orphan', 'repo_orphan', 'sha_orphan', 'delete', NOW());

      INSERT INTO "Report"
        ("id", "organizationId", "requestedById", "reportType", "targetLabel", "repositoryId",
         "periodStart", "periodEnd", "title", "markdownContent", "status")
      VALUES
        ('report_app', 'org_1', 'user_1', 'REPOSITORY', 'app', 'repo_app', NOW(), NOW(), 'App', '# App', 'GENERATED'),
        ('report_pat', 'org_1', 'user_1', 'REPOSITORY', 'legacy', 'repo_pat', NOW(), NOW(), 'PAT', '# PAT', 'GENERATED'),
        ('report_org', 'org_1', 'user_1', 'TEAM', 'org', NULL, NOW(), NOW(), 'Org', '# Org', 'GENERATED');

      INSERT INTO "ReportSchedule"
        ("id", "organizationId", "createdById", "name", "reportType", "repositoryId",
         "employeeIds", "period", "cadence", "timeZone", "nextRunAt", "updatedAt")
      VALUES
        ('schedule_app', 'org_1', 'user_1', 'App schedule', 'REPOSITORY', 'repo_app', '{}', 'LAST_7_DAYS', 'WEEKLY', 'UTC', NOW(), NOW()),
        ('schedule_pat', 'org_1', 'user_1', 'PAT schedule', 'REPOSITORY', 'repo_pat', '{}', 'LAST_7_DAYS', 'WEEKLY', 'UTC', NOW(), NOW());

      INSERT INTO "CodeQualitySnapshot"
        ("id", "organizationId", "projectKey", "dayKey", "bugs", "vulnerabilities",
         "codeSmells", "securityHotspots", "gateStatus", "updatedAt")
      VALUES
        ('snapshot_app', 'org_1', 'sonar_app', '2026-07-17', 0, 0, 0, 0, 'OK', NOW()),
        ('snapshot_pat', 'org_1', 'sonar_pat', '2026-07-17', 0, 0, 0, 0, 'OK', NOW());

      INSERT INTO "AuditLog"
        ("id", "organizationId", "action", "entityType", "entityId", "metadataJson")
      VALUES
        ('audit_app', 'org_1', 'repository.keep', 'Repository', 'repo_app', '{"repositoryId":"repo_app"}'),
        ('audit_pat', 'org_1', 'repository.delete', 'Repository', 'repo_pat', '{"repositoryId":"repo_pat"}'),
        ('audit_org', 'org_1', 'organization.keep', 'Organization', 'org_1', '{}');
    `);

    await applyMigration(TARGET);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("keeps only same-tenant App-granted repositories and cascaded data", async () => {
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "Repository"`)).toBe(1);
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "Repository" WHERE "id"='repo_app'`)).toBe(1);
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "Commit" WHERE "id"='commit_app'`)).toBe(1);
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "Commit" WHERE "id" IN ('commit_pat','commit_orphan')`)).toBe(0);
  });

  it("deletes loose repository references while retaining unrelated organization data", async () => {
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "Report" WHERE "id"='report_pat'`)).toBe(0);
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "Report" WHERE "id" IN ('report_app','report_org')`)).toBe(2);
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "ReportSchedule" WHERE "id"='schedule_pat'`)).toBe(0);
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "CodeQualitySnapshot" WHERE "id"='snapshot_pat'`)).toBe(0);
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "AuditLog" WHERE "id"='audit_pat'`)).toBe(0);
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM "AuditLog" WHERE "id" IN ('audit_app','audit_org')`)).toBe(2);
  });

  it("removes the credential and per-repository webhook schema", async () => {
    expect(await scalar(`SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_name='GitCredential'`)).toBe(0);
    expect(
      await scalar(`SELECT COUNT(*)::int AS count FROM information_schema.columns
        WHERE table_name='Repository'
          AND column_name IN ('credentialId','webhookExternalId','webhookSecret')`)
    ).toBe(0);
    expect(
      await scalar(`SELECT COUNT(*)::int AS count FROM pg_type WHERE typname='CredentialStatus'`)
    ).toBe(0);
    expect(
      await scalar(`SELECT COUNT(*)::int AS count FROM information_schema.columns
        WHERE table_name='Repository' AND column_name='appInstallationId' AND is_nullable='NO'`)
    ).toBe(1);
  });
});
