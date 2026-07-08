import type { GitCredential, GitProvider as GitProviderName } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import {
  decryptToken,
  encryptToken,
  tokenLast4
} from "../../common/crypto/token-cipher.js";
import { getGitProvider } from "../git-providers/provider-registry.js";

type ConnectCredentialInput = {
  organizationId: string;
  provider: GitProviderName;
  token: string;
};

/**
 * Public shape of a credential. The encrypted token is NEVER included — this
 * is what leaves the service toward controllers and the frontend.
 */
function toCredential(credential: GitCredential) {
  return {
    id: credential.id,
    provider: credential.provider,
    status: credential.status,
    tokenLast4: credential.tokenLast4,
    accountLogin: credential.accountLogin,
    scopes: credential.scopes ? credential.scopes.split(",").filter(Boolean) : [],
    lastValidatedAt: credential.lastValidatedAt,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt
  };
}

async function loadCredential(credentialId: string) {
  const credential = await prisma.gitCredential.findUnique({
    where: { id: credentialId }
  });

  if (!credential) {
    throw new AppError(404, "Git credential was not found", "CREDENTIAL_NOT_FOUND");
  }

  return credential;
}

export async function listCredentials(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);

  const credentials = await prisma.gitCredential.findMany({
    where: { organizationId },
    orderBy: { createdAt: "asc" }
  });

  return credentials.map(toCredential);
}

/**
 * Validates the PAT against the provider, then stores it encrypted. Because an
 * organization holds a single credential per provider, this upserts: a second
 * connect replaces the previous token (same effect as reconnect).
 */
export async function connectCredential(actorId: string, input: ConnectCredentialInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  const validation = await getGitProvider(input.provider).validateCredential(input.token);

  if (!validation.valid) {
    throw new AppError(400, "The provider rejected this token", "INVALID_CREDENTIAL");
  }

  const encryptedToken = encryptToken(input.token);
  const last4 = tokenLast4(input.token);
  const scopes = validation.scopes?.join(",") ?? null;
  const now = new Date();

  const credential = await prisma.$transaction(async (tx) => {
    const saved = await tx.gitCredential.upsert({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: input.provider
        }
      },
      create: {
        organizationId: input.organizationId,
        provider: input.provider,
        encryptedToken,
        tokenLast4: last4,
        accountLogin: validation.accountLogin ?? null,
        scopes,
        status: "CONNECTED",
        lastValidatedAt: now,
        createdById: actorId
      },
      update: {
        encryptedToken,
        tokenLast4: last4,
        accountLogin: validation.accountLogin ?? null,
        scopes,
        status: "CONNECTED",
        lastValidatedAt: now
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId,
        action: "credential.connect",
        entityType: "GitCredential",
        entityId: saved.id,
        // Never record the token itself.
        metadataJson: {
          provider: input.provider,
          accountLogin: validation.accountLogin ?? null
        }
      }
    });

    return saved;
  });

  return toCredential(credential);
}

/** Re-checks a stored token against the provider and refreshes its status. */
export async function validateStoredCredential(actorId: string, credentialId: string) {
  const credential = await loadCredential(credentialId);
  await requireOrganizationRole(actorId, credential.organizationId, MANAGER_ROLES);

  const validation = await getGitProvider(credential.provider).validateCredential(
    decryptToken(credential.encryptedToken)
  );

  const updated = await prisma.gitCredential.update({
    where: { id: credentialId },
    data: {
      status: validation.valid ? "CONNECTED" : "INVALID",
      lastValidatedAt: new Date(),
      ...(validation.valid
        ? {
            accountLogin: validation.accountLogin ?? null,
            scopes: validation.scopes?.join(",") ?? null
          }
        : {})
    }
  });

  return toCredential(updated);
}

/** Replaces the token on an existing credential (validating the new one). */
export async function reconnectCredential(
  actorId: string,
  credentialId: string,
  token: string
) {
  const credential = await loadCredential(credentialId);
  await requireOrganizationRole(actorId, credential.organizationId, MANAGER_ROLES);

  const validation = await getGitProvider(credential.provider).validateCredential(token);

  if (!validation.valid) {
    throw new AppError(400, "The provider rejected this token", "INVALID_CREDENTIAL");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.gitCredential.update({
      where: { id: credentialId },
      data: {
        encryptedToken: encryptToken(token),
        tokenLast4: tokenLast4(token),
        accountLogin: validation.accountLogin ?? null,
        scopes: validation.scopes?.join(",") ?? null,
        status: "CONNECTED",
        lastValidatedAt: new Date()
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: credential.organizationId,
        actorId,
        action: "credential.reconnect",
        entityType: "GitCredential",
        entityId: credentialId,
        metadataJson: { provider: credential.provider }
      }
    });

    return saved;
  });

  return toCredential(updated);
}

export async function deleteCredential(actorId: string, credentialId: string) {
  const credential = await loadCredential(credentialId);
  await requireOrganizationRole(actorId, credential.organizationId, MANAGER_ROLES);

  await prisma.$transaction(async (tx) => {
    await tx.gitCredential.delete({ where: { id: credentialId } });

    await tx.auditLog.create({
      data: {
        organizationId: credential.organizationId,
        actorId,
        action: "credential.delete",
        entityType: "GitCredential",
        entityId: credentialId,
        metadataJson: { provider: credential.provider }
      }
    });
  });

  return { id: credentialId };
}
