import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { prisma } from "../../config/database.js";

import type { AuthorIssueBreakdown } from "./code-quality-provider.js";
import { getCodeQualityProvider } from "./code-quality-registry.js";
import type { CodeQualityQuery } from "./code-quality.schemas.js";

type EmployeeRef = { userId: string; name: string; email: string };

type DeveloperQuality = AuthorIssueBreakdown & {
  /** Matched employee, or null when the git author isn't mapped to anyone. */
  employee: EmployeeRef | null;
};

/**
 * Builds a lowercase-email → employee lookup from BOTH the declared aliases
 * (`EmployeeGitAlias`) and the discovered, mapped contributors
 * (`ContributorIdentity` + `EmployeeGitMapping`). Aliases win on conflict.
 * Matching is case-insensitive because git author emails vary in case.
 */
async function buildEmailToEmployee(organizationId: string): Promise<Map<string, EmployeeRef>> {
  const [aliases, mappedContributors] = await Promise.all([
    prisma.employeeGitAlias.findMany({
      where: { organizationId, email: { not: null } },
      select: { email: true, user: { select: { id: true, name: true, email: true } } }
    }),
    prisma.contributorIdentity.findMany({
      where: { organizationId, authorEmail: { not: null }, mapping: { isNot: null } },
      select: {
        authorEmail: true,
        mapping: { select: { user: { select: { id: true, name: true, email: true } } } }
      }
    })
  ]);

  const map = new Map<string, EmployeeRef>();

  // Discovered mappings first, then let declared aliases override them.
  for (const c of mappedContributors) {
    const user = c.mapping?.user;
    if (!c.authorEmail || !user) continue;
    map.set(c.authorEmail.toLowerCase(), { userId: user.id, name: user.name, email: user.email });
  }
  for (const a of aliases) {
    if (!a.email) continue;
    map.set(a.email.toLowerCase(), { userId: a.user.id, name: a.user.name, email: a.user.email });
  }

  return map;
}

/**
 * Code-quality overview for an org's SonarQube project: headline measures plus
 * per-git-author issue breakdown, each author joined to an employee where the
 * org's git mappings allow. Degrades gracefully (available:false) when no
 * provider is configured, mirroring how reports never hard-fail on LLM absence.
 */
export async function getCodeQualityOverview(actorId: string, query: CodeQualityQuery) {
  await requireOrganizationMember(actorId, query.organizationId);

  const provider = getCodeQualityProvider();

  if (!provider.available) {
    return {
      projectKey: query.projectKey,
      available: false,
      capabilities: provider.capabilities,
      measures: null,
      developers: [] as DeveloperQuality[]
    };
  }

  const [measures, issuesByAuthor, emailToEmployee] = await Promise.all([
    provider.getMeasures(query.projectKey),
    provider.getIssuesByAuthor(query.projectKey),
    buildEmailToEmployee(query.organizationId)
  ]);

  const developers: DeveloperQuality[] = issuesByAuthor.map((row) => ({
    ...row,
    employee: emailToEmployee.get(row.author.toLowerCase()) ?? null
  }));

  return {
    projectKey: query.projectKey,
    available: true,
    capabilities: provider.capabilities,
    measures,
    developers
  };
}
