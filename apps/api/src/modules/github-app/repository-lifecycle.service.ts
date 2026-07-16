import { Prisma } from "@prisma/client";

import { prisma } from "../../config/database.js";

type TxClient = Prisma.TransactionClient;

/**
 * Permanently removes repository-scoped DevInside data. Reports, schedules,
 * code-quality snapshots, and some audit references have no repository FK, so
 * they must be cleaned explicitly before Repository's cascades run.
 */
export async function deleteRepositoryDataInTransaction(
  tx: TxClient,
  repositoryIds: string[]
): Promise<void> {
  const ids = [...new Set(repositoryIds.filter(Boolean))];
  if (ids.length === 0) return;

  const repositories = await tx.repository.findMany({
    where: { id: { in: ids } },
    select: { id: true, organizationId: true, sonarProjectKey: true }
  });
  if (repositories.length === 0) return;

  const existingIds = repositories.map((repository) => repository.id);

  await tx.report.deleteMany({ where: { repositoryId: { in: existingIds } } });
  await tx.reportSchedule.deleteMany({ where: { repositoryId: { in: existingIds } } });

  for (const repository of repositories) {
    if (!repository.sonarProjectKey) continue;
    await tx.codeQualitySnapshot.deleteMany({
      where: {
        organizationId: repository.organizationId,
        projectKey: repository.sonarProjectKey
      }
    });
  }

  await tx.auditLog.deleteMany({ where: { entityId: { in: existingIds } } });
  await tx.$executeRaw(
    Prisma.sql`DELETE FROM "AuditLog" WHERE "metadataJson" ->> 'repositoryId' IN (${Prisma.join(existingIds)})`
  );

  await tx.repository.deleteMany({ where: { id: { in: existingIds } } });
}

export async function deleteRepositoryData(repositoryIds: string[]): Promise<void> {
  await prisma.$transaction((tx) => deleteRepositoryDataInTransaction(tx, repositoryIds));
}

/**
 * After grants are revoked, move repositories to another same-tenant grant when
 * one exists; otherwise apply the destructive repository cleanup contract.
 */
export async function reassignOrDeleteRepositoriesInTransaction(
  tx: TxClient,
  repositoryIds: string[]
): Promise<void> {
  const ids = [...new Set(repositoryIds.filter(Boolean))];
  if (!ids.length) return;

  const repositories = await tx.repository.findMany({
    where: { id: { in: ids } },
    select: { id: true, organizationId: true }
  });
  const access = await tx.repositoryAccess.findMany({
    where: { repositoryId: { in: ids } },
    select: {
      repositoryId: true,
      appInstallationId: true,
      installation: { select: { organizationId: true } }
    },
    orderBy: { createdAt: "asc" }
  });

  const deleteIds: string[] = [];
  for (const repository of repositories) {
    const replacement = access.find(
      (grant) =>
        grant.repositoryId === repository.id &&
        grant.installation.organizationId === repository.organizationId
    );
    if (replacement) {
      await tx.repository.update({
        where: { id: repository.id },
        data: { appInstallationId: replacement.appInstallationId }
      });
    } else {
      deleteIds.push(repository.id);
    }
  }

  await deleteRepositoryDataInTransaction(tx, deleteIds);
}
