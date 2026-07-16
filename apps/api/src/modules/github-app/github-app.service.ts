import type { GitHubAppInstallation } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import type { GitRepository } from "../git-providers/git-provider.js";
import {
  getAppInstallUrl,
  githubAppClient,
  isGitHubAppConfigured
} from "./github-app.auth.js";
import { ensureInitialAppBackfill } from "../activity/deep-collection.js";
import { reassignOrDeleteRepositoriesInTransaction } from "./repository-lifecycle.service.js";
import { resolveOrganizationToken } from "./repository-token.js";

/**
 * GitHub App installation lifecycle: link (post-install callback), status, repo
 * synchronization, resync, disconnect, and webhook-driven updates. Follows the
 * existing service conventions — RBAC via organization-access, mutations audit
 * logged inside a $transaction, no secret ever returned to the frontend. The App
 * private key and installation tokens live only in github-app.auth.ts.
 */

const PROVIDER = "GITHUB" as const;

/** Public DTO — the model holds no secrets, but we shape it explicitly anyway. */
function toInstallation(installation: GitHubAppInstallation) {
  return {
    id: installation.id,
    installationId: installation.installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    targetType: installation.targetType,
    repositorySelection: installation.repositorySelection,
    repositoryCount: installation.repositoryCount,
    suspended: installation.suspendedAt !== null,
    lastSyncedAt: installation.lastSyncedAt,
    createdAt: installation.createdAt
  };
}

export type InstallationDto = ReturnType<typeof toInstallation>;

/** Connection status for an organization (member-visible). */
export async function getStatus(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);

  const installations = await prisma.gitHubAppInstallation.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" }
  });

  return {
    configured: isGitHubAppConfigured(),
    connected: installations.length > 0,
    installations: installations.map(toInstallation)
  };
}

/** Returns the GitHub App install URL for a manager to start the flow. */
export async function getInstallUrl(actorId: string, organizationId: string) {
  await requireOrganizationRole(actorId, organizationId, MANAGER_ROLES);
  return { url: getAppInstallUrl(organizationId) };
}

/** Resolves a GitHub handle with the organization's App installation token. */
export async function resolveGitHubUser(
  actorId: string,
  organizationId: string,
  username: string
) {
  await requireOrganizationRole(actorId, organizationId, MANAGER_ROLES);
  const { token, provider } = await resolveOrganizationToken(organizationId);
  return provider.getUser(token, username);
}

/**
 * Links a completed GitHub App installation to this organization (called from
 * the frontend callback, which carries the user's JWT → the DevInside org).
 * Validates the installation against GitHub, enforces the cross-tenant guard
 * (one GitHub installation belongs to exactly one DevInside org), persists it,
 * then synchronizes the accessible repositories.
 */
export async function linkInstallation(
  actorId: string,
  input: { organizationId: string; installationId: string; setupAction?: string }
) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  if (!isGitHubAppConfigured()) {
    throw new AppError(
      503,
      "The GitHub App is not configured on this server yet.",
      "GITHUB_APP_NOT_CONFIGURED"
    );
  }

  // Cross-tenant protection: a GitHub installation may only ever map to one org.
  const existing = await prisma.gitHubAppInstallation.findUnique({
    where: { installationId: input.installationId }
  });
  if (existing && existing.organizationId !== input.organizationId) {
    throw new AppError(
      409,
      "This GitHub installation is already connected to another DevInside organization.",
      "INSTALLATION_CLAIMED"
    );
  }

  // Confirm the installation exists (and read its account) straight from GitHub,
  // so a forged installation_id can't be linked.
  const remote = await githubAppClient.getInstallation(input.installationId);
  if (!remote) {
    throw new AppError(404, "GitHub App installation not found", "INSTALLATION_NOT_FOUND");
  }

  const installation = await prisma.gitHubAppInstallation.upsert({
    where: { installationId: input.installationId },
    create: {
      organizationId: input.organizationId,
      installationId: remote.installationId,
      accountLogin: remote.accountLogin,
      accountType: remote.accountType,
      accountId: remote.accountId,
      targetType: remote.targetType,
      repositorySelection: remote.repositorySelection,
      permissions: remote.permissions ?? undefined,
      suspendedAt: remote.suspendedAt ? new Date(remote.suspendedAt) : null,
      createdById: actorId
    },
    update: {
      accountLogin: remote.accountLogin,
      accountType: remote.accountType,
      accountId: remote.accountId,
      targetType: remote.targetType,
      repositorySelection: remote.repositorySelection,
      permissions: remote.permissions ?? undefined,
      suspendedAt: remote.suspendedAt ? new Date(remote.suspendedAt) : null
    }
  });

  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId,
      action: "github_app.installation.link",
      entityType: "GitHubAppInstallation",
      entityId: installation.id,
      metadataJson: {
        installationId: installation.installationId,
        account: installation.accountLogin,
        setupAction: input.setupAction ?? null
      }
    }
  });

  await syncInstallationRepositories(installation);
  return getStatus(actorId, input.organizationId);
}

/** Manager-triggered resync of one installation's repositories. */
export async function syncInstallation(
  actorId: string,
  organizationId: string,
  appInstallationId: string
) {
  await requireOrganizationRole(actorId, organizationId, MANAGER_ROLES);

  const installation = await loadOwnedInstallation(organizationId, appInstallationId);
  const count = await syncInstallationRepositories(installation);

  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId,
      action: "github_app.installation.sync",
      entityType: "GitHubAppInstallation",
      entityId: installation.id,
      metadataJson: { installationId: installation.installationId, repositoryCount: count }
    }
  });

  return getStatus(actorId, organizationId);
}

/**
 * Disconnects an installation from DevInside and deletes every repository/data
 * row that depended on it. It does not uninstall the App on GitHub; the customer
 * does that separately in their GitHub settings.
 */
export async function disconnectInstallation(
  actorId: string,
  organizationId: string,
  appInstallationId: string
) {
  await requireOrganizationRole(actorId, organizationId, MANAGER_ROLES);

  const installation = await loadOwnedInstallation(organizationId, appInstallationId);

  await prisma.$transaction(async (tx) => {
    const repositories = await tx.repository.findMany({
      where: { appInstallationId: installation.id },
      select: { id: true }
    });
    await tx.repositoryAccess.deleteMany({ where: { appInstallationId: installation.id } });
    await reassignOrDeleteRepositoriesInTransaction(
      tx,
      repositories.map((repository) => repository.id)
    );
    await tx.gitHubAppInstallation.delete({ where: { id: installation.id } });
    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: "github_app.installation.disconnect",
        entityType: "GitHubAppInstallation",
        entityId: installation.id,
        metadataJson: {
          installationId: installation.installationId,
          account: installation.accountLogin
        }
      }
    });
  });

  return getStatus(actorId, organizationId);
}

async function loadOwnedInstallation(organizationId: string, appInstallationId: string) {
  const installation = await prisma.gitHubAppInstallation.findFirst({
    where: { id: appInstallationId, organizationId }
  });
  if (!installation) {
    throw new AppError(404, "GitHub App installation not found", "INSTALLATION_NOT_FOUND");
  }
  return installation;
}

/**
 * Fetches the installation's accessible repositories and reconciles them into
 * Repository + RepositoryAccess. Repositories no longer granted to any linked
 * App installation are deleted with their local reports/history.
 */
async function syncInstallationRepositories(installation: GitHubAppInstallation): Promise<number> {
  const accessToken = await githubAppClient.createInstallationAccessToken(
    installation.installationId
  );
  const repos = await githubAppClient.listInstallationRepositories(accessToken.token);
  const now = new Date();

  const repositoryIds = await prisma.$transaction(async (tx) => {
    const previousRepositories = await tx.repository.findMany({
      where: { appInstallationId: installation.id },
      select: { id: true }
    });
    const repositoryIds: string[] = [];

    for (const repo of repos) {
      const saved = await upsertRepository(tx, installation, repo, now);
      repositoryIds.push(saved.id);
      await tx.repositoryAccess.upsert({
        where: {
          appInstallationId_repositoryId: {
            appInstallationId: installation.id,
            repositoryId: saved.id
          }
        },
        create: { appInstallationId: installation.id, repositoryId: saved.id },
        update: {}
      });
    }

    // Revoke grants for repos no longer accessible and remove ungranted data.
    const currentIds = new Set(repositoryIds);
    const removedCandidates = previousRepositories
      .map((repository) => repository.id)
      .filter((repositoryId) => !currentIds.has(repositoryId));

    await tx.repositoryAccess.deleteMany({
      where: { appInstallationId: installation.id, repositoryId: { notIn: repositoryIds } }
    });

    if (removedCandidates.length) {
      await reassignOrDeleteRepositoriesInTransaction(tx, removedCandidates);
    }

    await tx.gitHubAppInstallation.update({
      where: { id: installation.id },
      data: { repositoryCount: repositoryIds.length, lastSyncedAt: now }
    });

    return repositoryIds;
  });

  await Promise.all(
    repositoryIds.map((repositoryId) =>
      ensureInitialAppBackfill(repositoryId).catch((error) => {
        console.warn(`[github-app] initial backfill queue failed for repository ${repositoryId}`, error);
        return false;
      })
    )
  );

  return repos.length;
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function upsertRepository(
  tx: TxClient,
  installation: GitHubAppInstallation,
  repo: GitRepository,
  now: Date
) {
  return tx.repository.upsert({
    where: {
      organizationId_provider_externalId: {
        organizationId: installation.organizationId,
        provider: PROVIDER,
        externalId: repo.externalId
      }
    },
    create: {
      organizationId: installation.organizationId,
      appInstallationId: installation.id,
      provider: PROVIDER,
      externalId: repo.externalId,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      remoteUrl: repo.remoteUrl,
      isPrivate: repo.isPrivate,
      defaultBranch: repo.defaultBranch ?? null,
      lastSyncedAt: now
    },
    update: {
      appInstallationId: installation.id,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      remoteUrl: repo.remoteUrl,
      isPrivate: repo.isPrivate,
      defaultBranch: repo.defaultBranch ?? null,
      lastSyncedAt: now
    }
  });
}

// --- Webhook-driven updates (no actor — system events, verified upstream) ----

export type WebhookInstallationPayload = {
  action?: string;
  installation?: { id?: number; suspended_at?: string | null };
};

/** Handles a verified `installation` App webhook event. */
export async function handleInstallationEvent(payload: WebhookInstallationPayload) {
  const installationId = payload.installation?.id;
  if (installationId === undefined) {
    return;
  }
  const idStr = String(installationId);
  const local = await prisma.gitHubAppInstallation.findUnique({
    where: { installationId: idStr }
  });

  if (payload.action === "deleted") {
    // Uninstalled on GitHub — delete the local link and its repository data.
    if (local) {
      await prisma.$transaction(async (tx) => {
        const repositories = await tx.repository.findMany({
          where: { appInstallationId: local.id },
          select: { id: true }
        });
        await tx.repositoryAccess.deleteMany({ where: { appInstallationId: local.id } });
        await reassignOrDeleteRepositoriesInTransaction(
          tx,
          repositories.map((repository) => repository.id)
        );
        await tx.gitHubAppInstallation.delete({ where: { id: local.id } });
      });
      await recordSystemAudit(local, "github_app.installation.deleted");
    }
    return;
  }

  // We only know which DevInside org an installation belongs to once it has been
  // linked via the JWT-authenticated callback. Unknown installations are ignored.
  if (!local) {
    return;
  }

  if (payload.action === "suspend") {
    await prisma.gitHubAppInstallation.update({
      where: { id: local.id },
      data: { suspendedAt: new Date() }
    });
    return;
  }
  if (payload.action === "unsuspend") {
    await prisma.gitHubAppInstallation.update({
      where: { id: local.id },
      data: { suspendedAt: null }
    });
    return;
  }

  // created / new_permissions_accepted for a known installation → resync.
  await syncInstallationRepositories(local).catch((error) => {
    console.warn(`[github-app] resync failed for installation ${idStr}`, error);
  });
}

/** Handles a verified `installation_repositories` App webhook event. */
export async function handleInstallationRepositoriesEvent(payload: WebhookInstallationPayload) {
  const installationId = payload.installation?.id;
  if (installationId === undefined) {
    return;
  }
  const local = await prisma.gitHubAppInstallation.findUnique({
    where: { installationId: String(installationId) }
  });
  if (!local) {
    return;
  }
  await syncInstallationRepositories(local).catch((error) => {
    console.warn(`[github-app] repo-access resync failed for installation ${local.installationId}`, error);
  });
}

async function recordSystemAudit(installation: GitHubAppInstallation, action: string) {
  await prisma.auditLog
    .create({
      data: {
        organizationId: installation.organizationId,
        action,
        entityType: "GitHubAppInstallation",
        entityId: installation.id,
        metadataJson: { installationId: installation.installationId }
      }
    })
    .catch(() => {});
}
