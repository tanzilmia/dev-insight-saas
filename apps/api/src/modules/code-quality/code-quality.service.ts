import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { prisma } from "../../config/database.js";

import type { AuthorIssueBreakdown } from "./code-quality-provider.js";
import { getCodeQualityProvider } from "./code-quality-registry.js";
import { recordCodeQualitySnapshot } from "./snapshots.service.js";
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

  const provider = await getCodeQualityProvider(query.organizationId);

  if (!provider.available) {
    return {
      projectKey: query.projectKey,
      available: false,
      capabilities: provider.capabilities,
      measures: null,
      qualityGate: null,
      developers: [] as DeveloperQuality[]
    };
  }

  const [measures, issuesByAuthor, qualityGate, emailToEmployee] = await Promise.all([
    provider.getMeasures(query.projectKey),
    provider.getIssuesByAuthor(query.projectKey),
    // A project may have no gate configured; don't let that fail the overview.
    provider.getQualityGate(query.projectKey).catch(() => null),
    buildEmailToEmployee(query.organizationId)
  ]);

  const developers: DeveloperQuality[] = issuesByAuthor.map((row) => ({
    ...row,
    employee: emailToEmployee.get(row.author.toLowerCase()) ?? null
  }));

  // Record today's snapshot so trend history accrues as the page is viewed
  // (the scheduler sweep also captures). Best-effort — never fail the overview.
  await recordCodeQualitySnapshot(
    query.organizationId,
    query.projectKey,
    measures,
    qualityGate?.status ?? "NONE"
  ).catch(() => undefined);

  return {
    projectKey: query.projectKey,
    available: true,
    capabilities: provider.capabilities,
    measures,
    qualityGate,
    developers
  };
}

const GATE_RANK: Record<string, number> = { OK: 1, WARN: 2, ERROR: 3 };

/**
 * Org-wide code-health rollup across every repo mapped to a SonarQube project:
 * summed issue counts, ncloc-weighted coverage, and the worst quality gate. For
 * the Overview "Code health" card. Best-effort: a project that errors is skipped.
 */
export async function getCodeQualitySummary(
  actorId: string,
  organizationId: string,
  projectId?: string
) {
  await requireOrganizationMember(actorId, organizationId);

  const provider = await getCodeQualityProvider(organizationId);
  if (!provider.available) {
    return { available: false as const, reason: "not_configured" as const };
  }

  const repos = await prisma.repository.findMany({
    where: { organizationId, sonarProjectKey: { not: null }, ...(projectId ? { projectId } : {}) },
    select: { sonarProjectKey: true }
  });
  const projectKeys = [
    ...new Set(repos.map((r) => r.sonarProjectKey).filter((k): k is string => Boolean(k)))
  ];
  if (projectKeys.length === 0) {
    return { available: false as const, reason: "no_project_mapped" as const };
  }

  const results = await Promise.all(
    projectKeys.map(async (key) => {
      try {
        const [measures, gate] = await Promise.all([
          provider.getMeasures(key),
          provider.getQualityGate(key).catch(() => null)
        ]);
        return { key, measures, gate };
      } catch {
        return null; // project unreachable/missing — skip
      }
    })
  );

  const projects = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (projects.length === 0) {
    return { available: false as const, reason: "unreachable" as const };
  }

  const totals = { bugs: 0, vulnerabilities: 0, codeSmells: 0, securityHotspots: 0 };
  let coverageWeightedSum = 0;
  let coverageWeight = 0;
  let worstGateRank = 0;

  for (const { measures, gate } of projects) {
    totals.bugs += measures.bugs ?? 0;
    totals.vulnerabilities += measures.vulnerabilities ?? 0;
    totals.codeSmells += measures.codeSmells ?? 0;
    totals.securityHotspots += measures.securityHotspots ?? 0;
    if (measures.coverage !== null) {
      const weight = measures.linesOfCode ?? 1;
      coverageWeightedSum += measures.coverage * weight;
      coverageWeight += weight;
    }
    if (gate) worstGateRank = Math.max(worstGateRank, GATE_RANK[gate.status] ?? 0);
  }

  const worstGate =
    worstGateRank === 3 ? "ERROR" : worstGateRank === 2 ? "WARN" : worstGateRank === 1 ? "OK" : "NONE";

  return {
    available: true as const,
    projectCount: projects.length,
    totals,
    coverage: coverageWeight > 0 ? Math.round((coverageWeightedSum / coverageWeight) * 10) / 10 : null,
    worstGate,
    projects: projects.map(({ key, measures, gate }) => ({
      key,
      bugs: measures.bugs ?? 0,
      vulnerabilities: measures.vulnerabilities ?? 0,
      coverage: measures.coverage,
      gate: gate?.status ?? "NONE"
    }))
  };
}
