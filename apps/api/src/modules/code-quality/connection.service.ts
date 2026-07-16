import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { AppError } from "../../common/errors/app-error.js";
import { encryptToken } from "../../common/crypto/token-cipher.js";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";

import { getCodeQualityProvider } from "./code-quality-registry.js";
import { SonarQubeProvider } from "./sonarqube.provider.js";
import type { CodeQualityConnectionInput } from "./code-quality.schemas.js";

type ConnectionRow = {
  provider: string;
  baseUrl: string;
  organizationKey: string | null;
  status: string | null;
  lastCheckedAt: Date | null;
};

/** Public shape — NEVER includes the token. */
function toDto(connection: ConnectionRow) {
  return {
    connected: true,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    organizationKey: connection.organizationKey,
    status: connection.status,
    lastCheckedAt: connection.lastCheckedAt
  };
}

/** Current connection (token never returned). Notes if the env fallback is live. */
export async function getConnection(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);
  const connection = await prisma.codeQualityConnection.findUnique({ where: { organizationId } });
  if (connection) return toDto(connection);
  return { connected: false, envFallback: Boolean(env.SONAR_TOKEN) };
}

/** Validates a base URL + token against SonarQube; never persists. */
export async function testConnection(actorId: string, input: CodeQualityConnectionInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);
  const provider = new SonarQubeProvider({
    baseUrl: input.baseUrl,
    token: input.token,
    organizationKey: input.organizationKey ?? null
  });
  const valid = await provider.validate();
  return { valid, status: valid ? "OK" : "INVALID" };
}

/** Tests then saves the connection (token encrypted at rest). Manager-gated. */
export async function saveConnection(actorId: string, input: CodeQualityConnectionInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  const probe = new SonarQubeProvider({
    baseUrl: input.baseUrl,
    token: input.token,
    organizationKey: input.organizationKey ?? null
  });
  if (!(await probe.validate())) {
    throw new AppError(
      400,
      "SonarQube rejected the token or the server is unreachable",
      "CODE_QUALITY_CONNECTION_INVALID"
    );
  }

  const tokenCipher = encryptToken(input.token);
  const data = {
    provider: input.provider,
    baseUrl: input.baseUrl,
    tokenCipher,
    organizationKey: input.organizationKey ?? null,
    status: "OK",
    lastCheckedAt: new Date()
  };

  const connection = await prisma.$transaction(async (tx) => {
    const saved = await tx.codeQualityConnection.upsert({
      where: { organizationId: input.organizationId },
      create: { organizationId: input.organizationId, ...data },
      update: data
    });
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId,
        action: "code_quality.connect",
        entityType: "CodeQualityConnection",
        entityId: saved.id,
        metadataJson: { provider: input.provider, baseUrl: input.baseUrl }
      }
    });
    return saved;
  });

  return toDto(connection);
}

/** Removes the connection (org falls back to env, or unavailable). */
export async function deleteConnection(actorId: string, organizationId: string) {
  await requireOrganizationRole(actorId, organizationId, MANAGER_ROLES);
  await prisma.codeQualityConnection.deleteMany({ where: { organizationId } });
  await prisma.auditLog.create({
    data: {
      organizationId,
      actorId,
      action: "code_quality.disconnect",
      entityType: "CodeQualityConnection",
      entityId: organizationId
    }
  });
  return { connected: false, envFallback: Boolean(env.SONAR_TOKEN) };
}

/** Projects the configured token can see — for the repo→project dropdown. */
export async function listSonarProjects(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);
  const provider = await getCodeQualityProvider(organizationId);
  if (!provider.available) return { available: false, projects: [] };
  const projects = await provider.listProjects();

  // Tenant isolation: when the org has its OWN connection, the token only sees
  // that server's projects (already isolated). When it uses the SHARED env
  // fallback, the token can see every customer's project — so restrict the list
  // to projects mapped to THIS org's repos, or one customer could enumerate
  // another's project keys (which reveal repo/company names).
  const ownConnection = await prisma.codeQualityConnection.findUnique({
    where: { organizationId },
    select: { id: true }
  });
  if (ownConnection) {
    return { available: true, projects };
  }

  const mapped = await prisma.repository.findMany({
    where: { organizationId, sonarProjectKey: { not: null } },
    select: { sonarProjectKey: true }
  });
  const ownedKeys = new Set(mapped.map((r) => r.sonarProjectKey).filter((k): k is string => Boolean(k)));
  return { available: true, projects: projects.filter((p) => ownedKeys.has(p.key)) };
}
