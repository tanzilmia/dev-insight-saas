import { decryptToken } from "../../common/crypto/token-cipher.js";
import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";

import type { CodeQualityConfig, CodeQualityProvider } from "./code-quality-provider.js";
import { SonarQubeProvider } from "./sonarqube.provider.js";

/**
 * Resolves the effective config for an org: its saved `CodeQualityConnection`
 * (token decrypted) if present, else the env fallback (local dev / default).
 */
async function resolveConfig(organizationId: string): Promise<CodeQualityConfig> {
  const connection = await prisma.codeQualityConnection.findUnique({ where: { organizationId } });
  if (connection) {
    return {
      baseUrl: connection.baseUrl,
      token: decryptToken(connection.tokenCipher),
      organizationKey: connection.organizationKey
    };
  }
  return {
    baseUrl: env.SONAR_BASE_URL,
    token: env.SONAR_TOKEN ?? null,
    organizationKey: env.SONAR_ORGANIZATION ?? null
  };
}

/**
 * Returns the active code-quality provider for an organization. Only SonarQube
 * is wired (self-hosted, or SonarCloud when the connection carries an
 * organization key — same Web API, same class).
 */
export async function getCodeQualityProvider(organizationId: string): Promise<CodeQualityProvider> {
  return new SonarQubeProvider(await resolveConfig(organizationId));
}
