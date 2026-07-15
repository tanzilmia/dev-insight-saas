import { requireOrganizationMember } from "../../common/access/organization-access.js";
import { prisma } from "../../config/database.js";
import { toLocalDateKey } from "../statistics/statistics.service.js";

import type { QualityMeasures } from "./code-quality-provider.js";
import { getCodeQualityProvider } from "./code-quality-registry.js";
import type { CodeQualityTrendQuery } from "./code-quality.schemas.js";

/**
 * Upserts today's code-quality snapshot for a project (one row per local day,
 * overwritten with the latest capture). Called both on page load and by the
 * scheduler sweep, so trend history accrues however the feature is used.
 */
export async function recordCodeQualitySnapshot(
  organizationId: string,
  projectKey: string,
  measures: QualityMeasures,
  gateStatus: string
): Promise<void> {
  const dayKey = toLocalDateKey(new Date());
  const data = {
    capturedAt: new Date(),
    bugs: measures.bugs ?? 0,
    vulnerabilities: measures.vulnerabilities ?? 0,
    codeSmells: measures.codeSmells ?? 0,
    securityHotspots: measures.securityHotspots ?? 0,
    coverage: measures.coverage,
    duplicatedLinesDensity: measures.duplicatedLinesDensity,
    techDebtMinutes: measures.techDebtMinutes,
    linesOfCode: measures.linesOfCode,
    gateStatus,
    reliabilityRating: measures.reliabilityRating,
    securityRating: measures.securityRating,
    maintainabilityRating: measures.maintainabilityRating
  };
  await prisma.codeQualitySnapshot.upsert({
    where: { organizationId_projectKey_dayKey: { organizationId, projectKey, dayKey } },
    create: { organizationId, projectKey, dayKey, ...data },
    update: data
  });
}

/**
 * Scheduler sweep: for every org with a working provider, record today's
 * snapshot for each mapped SonarQube project. Idempotent (daily upsert) and
 * best-effort — a failing project/org is skipped. Returns rows written.
 */
export async function captureCodeQualitySnapshots(): Promise<number> {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let written = 0;

  for (const org of orgs) {
    const provider = await getCodeQualityProvider(org.id);
    if (!provider.available) continue;

    const repos = await prisma.repository.findMany({
      where: { organizationId: org.id, sonarProjectKey: { not: null } },
      select: { sonarProjectKey: true }
    });
    const keys = [
      ...new Set(repos.map((r) => r.sonarProjectKey).filter((k): k is string => Boolean(k)))
    ];

    for (const key of keys) {
      try {
        const [measures, gate] = await Promise.all([
          provider.getMeasures(key),
          provider.getQualityGate(key).catch(() => null)
        ]);
        await recordCodeQualitySnapshot(org.id, key, measures, gate?.status ?? "NONE");
        written += 1;
      } catch {
        // project unreachable / not analyzed yet — skip
      }
    }
  }

  return written;
}

const GATE_RANK: Record<string, number> = { OK: 1, WARN: 2, ERROR: 3 };

function gateWord(rank: number): string {
  if (rank === 3) return "❌ failed";
  if (rank === 2) return "⚠️ warning";
  if (rank === 1) return "✅ passed";
  return "no gate";
}

/**
 * Deterministic "## Code health" markdown for a report, built from stored
 * snapshots so it is **window-accurate**: current state vs the state at the start
 * of the report period (shown as "(was N)" deltas when history exists). Returns
 * "" when nothing is mapped or no snapshot has been captured yet, so reports with
 * no code-quality data are unaffected. Scope: a repository, a project, or org-wide.
 */
export async function buildCodeHealthMarkdown(
  organizationId: string,
  scope: { projectId?: string; repositoryId?: string },
  from: Date,
  to: Date
): Promise<string> {
  const repos = await prisma.repository.findMany({
    where: {
      organizationId,
      sonarProjectKey: { not: null },
      ...(scope.repositoryId ? { id: scope.repositoryId } : scope.projectId ? { projectId: scope.projectId } : {})
    },
    select: { sonarProjectKey: true }
  });
  const keys = [...new Set(repos.map((r) => r.sonarProjectKey).filter((k): k is string => Boolean(k)))];
  if (keys.length === 0) return "";

  const fromKey = toLocalDateKey(from);
  const toKey = toLocalDateKey(to);

  const cur = { bugs: 0, vulnerabilities: 0, codeSmells: 0, covSum: 0, covW: 0, gate: 0 };
  const base = { bugs: 0, vulnerabilities: 0, codeSmells: 0, covSum: 0, covW: 0 };
  let haveCurrent = false;
  let haveBaseline = false;

  for (const key of keys) {
    const current = await prisma.codeQualitySnapshot.findFirst({
      where: { organizationId, projectKey: key, dayKey: { lte: toKey } },
      orderBy: { dayKey: "desc" }
    });
    // Baseline = the state at the period start (latest snapshot on/before `from`).
    // If history only began mid-period, fall back to the earliest snapshot we have
    // (still ≤ `to`), so a delta appears as soon as there are two data points.
    const baseline =
      (await prisma.codeQualitySnapshot.findFirst({
        where: { organizationId, projectKey: key, dayKey: { lte: fromKey } },
        orderBy: { dayKey: "desc" }
      })) ??
      (await prisma.codeQualitySnapshot.findFirst({
        where: { organizationId, projectKey: key, dayKey: { lte: toKey } },
        orderBy: { dayKey: "asc" }
      }));
    if (current) {
      haveCurrent = true;
      cur.bugs += current.bugs;
      cur.vulnerabilities += current.vulnerabilities;
      cur.codeSmells += current.codeSmells;
      if (current.coverage !== null) {
        const w = current.linesOfCode ?? 1;
        cur.covSum += current.coverage * w;
        cur.covW += w;
      }
      cur.gate = Math.max(cur.gate, GATE_RANK[current.gateStatus] ?? 0);
    }
    if (baseline) {
      haveBaseline = true;
      base.bugs += baseline.bugs;
      base.vulnerabilities += baseline.vulnerabilities;
      base.codeSmells += baseline.codeSmells;
      if (baseline.coverage !== null) {
        const w = baseline.linesOfCode ?? 1;
        base.covSum += baseline.coverage * w;
        base.covW += w;
      }
    }
  }

  if (!haveCurrent) return "";

  const curCov = cur.covW > 0 ? Math.round((cur.covSum / cur.covW) * 10) / 10 : null;
  const baseCov = base.covW > 0 ? Math.round((base.covSum / base.covW) * 10) / 10 : null;
  const was = (metric: "bugs" | "vulnerabilities" | "codeSmells") =>
    haveBaseline && base[metric] !== cur[metric] ? ` (was ${base[metric]})` : "";
  const covWas = haveBaseline && baseCov !== null && baseCov !== curCov ? ` (was ${baseCov}%)` : "";

  const lines = [
    "## Code health",
    "",
    "Static-analysis snapshot from SonarQube for the analyzed code:",
    "",
    `- Quality gate: ${gateWord(cur.gate)}`,
    `- Bugs: ${cur.bugs}${was("bugs")}`,
    `- Vulnerabilities: ${cur.vulnerabilities}${was("vulnerabilities")}`,
    `- Code smells: ${cur.codeSmells}${was("codeSmells")}`,
    `- Test coverage: ${curCov === null ? "—" : `${curCov}%`}${covWas}`,
    "",
    "_This reflects the current state of the code (main branch), not only this period; \"(was …)\" compares to the start of the period where history exists._"
  ];
  return lines.join("\n");
}

/** Trend series (oldest→newest, for charting) for one project. Org-member gated. */
export async function getCodeQualityTrend(actorId: string, query: CodeQualityTrendQuery) {
  await requireOrganizationMember(actorId, query.organizationId);

  const snapshots = await prisma.codeQualitySnapshot.findMany({
    where: { organizationId: query.organizationId, projectKey: query.projectKey },
    orderBy: { dayKey: "desc" },
    take: query.limit
  });

  return snapshots
    .reverse()
    .map((s) => ({
      dayKey: s.dayKey,
      capturedAt: s.capturedAt,
      bugs: s.bugs,
      vulnerabilities: s.vulnerabilities,
      codeSmells: s.codeSmells,
      coverage: s.coverage,
      gateStatus: s.gateStatus
    }));
}
