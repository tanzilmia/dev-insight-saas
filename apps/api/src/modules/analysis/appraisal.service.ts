import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import {
  classifyCommit,
  hasRiskKeyword,
  isNoisePath,
  isSensitivePath,
  moduleFromPath
} from "../report-engine/commit-classifier.js";
import { humanizeAreas, humanizeWorkMix } from "../report-engine/plain-language.js";
import { buildEmployeeLeaderboard } from "../activity/activity.service.js";
import { resolvePeriod } from "../openclaw/openclaw.tools.js";
import { toLocalDateKey } from "../statistics/statistics.service.js";
import type { EmployeeAppraisalQuery } from "./analysis.schemas.js";

const APPRAISAL_COMMIT_CAP = 3000;
const APPRAISAL_FILE_CAP = 30_000;
const LARGE_COMMIT_THRESHOLD = 400;
const EVIDENCE_COUNT = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function firstLine(message: string, max = 140): string {
  const line = (message.split("\n")[0] ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Best-effort GitHub (or provider) URL for a commit, so evidence is clickable. */
function commitUrl(
  remoteUrl: string | null,
  owner: string,
  name: string,
  sha: string
): string {
  const base =
    remoteUrl && /^https?:\/\//.test(remoteUrl)
      ? remoteUrl.replace(/\.git$/, "")
      : `https://github.com/${owner}/${name}`;
  return `${base}/commit/${sha}`;
}

/** Enumerate the `YYYY-MM` month keys spanning [from, to], inclusive. */
function monthKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= end) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Per-employee **appraisal** — the evidence-backed picture management uses at
 * increment time. The product's core purpose: surface a person's real
 * contribution objectively so a good-but-quiet performer isn't overlooked in
 * favour of whoever has the team lead's ear.
 *
 * Deliberately **NOT a single score and NOT an AI verdict** — it returns
 * balanced, hard-to-game signals (consistency, breadth, ownership, work mix) plus
 * **clickable commit evidence** and an honest note on what Git can't measure, so a
 * human makes the fair decision. Deterministic (never calls an LLM) and
 * manager-gated. Line counts are noise-free (lockfiles/generated files excluded).
 */
export async function getEmployeeAppraisal(actorId: string, query: EmployeeAppraisalQuery) {
  await requireOrganizationRole(actorId, query.organizationId, MANAGER_ROLES);

  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId: query.organizationId, userId: query.userId, status: "ACTIVE" },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
  if (!membership) {
    throw new AppError(404, "Employee was not found in this organization", "EMPLOYEE_NOT_FOUND");
  }

  const project = query.projectId
    ? await prisma.project.findFirst({
        where: { id: query.projectId, organizationId: query.organizationId },
        select: { id: true, name: true }
      })
    : null;
  if (query.projectId && !project) {
    throw new AppError(404, "Project was not found", "PROJECT_NOT_FOUND");
  }

  // Range: an explicit custom window, else the last `months` months.
  const range =
    query.from && query.to
      ? resolvePeriod("custom", { from: query.from, to: query.to })
      : (() => {
          const to = new Date();
          const from = new Date(to);
          from.setMonth(from.getMonth() - query.months);
          from.setHours(0, 0, 0, 0);
          return { from, to };
        })();

  const mappings = await prisma.employeeGitMapping.findMany({
    where: { organizationId: query.organizationId, userId: query.userId },
    include: { contributorIdentity: { select: { username: true } } }
  });
  const usernames = [
    ...new Set(
      mappings
        .map((mapping) => mapping.contributorIdentity.username?.toLowerCase())
        .filter((username): username is string => Boolean(username))
    )
  ];

  const employee = {
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    usernames,
    hasGitIdentity: usernames.length > 0
  };

  const periodDays = Math.max(1, Math.ceil((range.to.getTime() - range.from.getTime() + 1) / (24 * 60 * 60 * 1000)));
  const totalWeeks = Math.max(1, Math.ceil(periodDays / 7));
  const monthKeys = monthKeysBetween(range.from, range.to);

  // No linked Git identity → an honest, empty appraisal (the mapping gap is the
  // finding, not a failure). This is exactly the person who'd otherwise be invisible.
  if (!employee.hasGitIdentity) {
    return {
      employee,
      period: { from: range.from, to: range.to, months: query.months, days: periodDays },
      scope: project ? { type: "project" as const, name: project.name } : { type: "organization" as const },
      hasGitIdentity: false,
      truncated: false,
      headline: null,
      consistency: {
        activeWeeks: 0,
        totalWeeks,
        activeWeekPct: 0,
        monthly: monthKeys.map((month) => ({ month, commits: 0, lines: 0 }))
      },
      workMix: { text: "", top: [] as { label: string; pct: number }[] },
      areas: [] as string[],
      ownership: { sensitiveAreaCommits: 0, moduleBreadth: 0, criticalAreas: [] as string[] },
      quality: { features: 0, bugFixes: 0, refactors: 0, largeCommits: 0, riskyCommits: 0 },
      teamComparison: null,
      evidence: [] as EvidenceItem[],
      dataBlindSpots: [
        `${employee.name} has no linked Git identity yet, so no work can be attributed. Link their GitHub username on the Contributors page — otherwise their contribution is invisible here.`
      ]
    };
  }

  const commits = await prisma.commit.findMany({
    where: {
      repository: {
        organizationId: query.organizationId,
        ...(project ? { projectId: project.id } : {})
      },
      committedAt: { gte: range.from, lte: range.to },
      username: { in: usernames, mode: "insensitive" }
    },
    orderBy: { committedAt: "desc" },
    take: APPRAISAL_COMMIT_CAP,
    select: {
      id: true,
      sha: true,
      message: true,
      committedAt: true,
      additions: true,
      deletions: true,
      repository: { select: { owner: true, name: true, remoteUrl: true } }
    }
  });

  const files = commits.length
    ? await prisma.changedFile.findMany({
        where: { commitId: { in: commits.map((commit) => commit.id) } },
        select: { commitId: true, filePath: true, additions: true, deletions: true },
        take: APPRAISAL_FILE_CAP
      })
    : [];
  const filesByCommit = new Map<string, typeof files>();
  for (const file of files) {
    const list = filesByCommit.get(file.commitId) ?? [];
    list.push(file);
    filesByCommit.set(file.commitId, list);
  }
  const truncated =
    commits.length >= APPRAISAL_COMMIT_CAP || files.length >= APPRAISAL_FILE_CAP;

  const activeDayKeys = new Set<string>();
  const activeWeekIndexes = new Set<number>();
  const moduleChanges = new Map<string, number>();
  const criticalAreas = new Set<string>();
  const categories: Record<string, number> = {};
  const monthlyMap = new Map<string, { commits: number; lines: number }>();

  let effectiveLines = 0;
  let rawLines = 0;
  let features = 0;
  let bugFixes = 0;
  let refactors = 0;
  let largeCommits = 0;
  let riskyCommits = 0;
  let sensitiveAreaCommits = 0;
  let firstCommitAt: Date | null = null;
  let lastCommitAt: Date | null = null;

  type ScoredCommit = {
    sha: string;
    message: string;
    committedAt: Date;
    category: string;
    lines: number;
    sensitive: boolean;
    url: string;
  };
  const scored: ScoredCommit[] = [];

  for (const commit of commits) {
    rawLines += commit.additions + commit.deletions;
    const commitFiles = filesByCommit.get(commit.id) ?? [];

    let commitEffective = 0;
    let commitSensitive = false;
    for (const file of commitFiles) {
      if (isNoisePath(file.filePath)) {
        continue;
      }
      commitEffective += file.additions + file.deletions;
      moduleChanges.set(
        moduleFromPath(file.filePath),
        (moduleChanges.get(moduleFromPath(file.filePath)) ?? 0) + file.additions + file.deletions
      );
      if (isSensitivePath(file.filePath)) {
        commitSensitive = true;
        criticalAreas.add(moduleFromPath(file.filePath));
      }
    }
    // No collected files → fall back to the commit-level total (undercorrection
    // is the safe direction; we never zero-out real work).
    if (commitFiles.length === 0) {
      commitEffective = commit.additions + commit.deletions;
    }
    effectiveLines += commitEffective;

    const category = classifyCommit(commit.message);
    categories[category] = (categories[category] ?? 0) + 1;
    if (category === "Feature") features += 1;
    else if (category === "Fix") bugFixes += 1;
    else if (category === "Refactor") refactors += 1;
    if (commit.additions + commit.deletions > LARGE_COMMIT_THRESHOLD) largeCommits += 1;
    if (hasRiskKeyword(commit.message)) riskyCommits += 1;
    if (commitSensitive) sensitiveAreaCommits += 1;

    activeDayKeys.add(toLocalDateKey(commit.committedAt));
    activeWeekIndexes.add(Math.floor((commit.committedAt.getTime() - range.from.getTime()) / WEEK_MS));

    const mKey = monthKey(commit.committedAt);
    const mBucket = monthlyMap.get(mKey) ?? { commits: 0, lines: 0 };
    mBucket.commits += 1;
    mBucket.lines += commitEffective;
    monthlyMap.set(mKey, mBucket);

    // Newest-first ordering.
    lastCommitAt = lastCommitAt ?? commit.committedAt;
    firstCommitAt = commit.committedAt;

    scored.push({
      sha: commit.sha.slice(0, 7),
      message: firstLine(commit.message),
      committedAt: commit.committedAt,
      category,
      lines: commitEffective,
      sensitive: commitSensitive,
      url: commitUrl(commit.repository.remoteUrl, commit.repository.owner, commit.repository.name, commit.sha)
    });
  }

  // Evidence: the most substantial work (by real lines), with sensitive-area
  // commits nudged up so security-critical work is always represented.
  const evidence: EvidenceItem[] = scored
    .slice()
    .sort((a, b) => Number(b.sensitive) - Number(a.sensitive) || b.lines - a.lines)
    .slice(0, EVIDENCE_COUNT)
    .sort((a, b) => b.committedAt.getTime() - a.committedAt.getTime());

  const workMix = humanizeWorkMix(categories);
  const areas = humanizeAreas(
    [...moduleChanges.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([module]) => ({ module }))
  );

  // Team comparison — same period, same scope. Two independent rankings (real
  // work volume AND commit count) so the reader never leans on one number. Reuses
  // the noise-free leaderboard.
  const teamLeaderboard = await buildEmployeeLeaderboard(
    {
      organizationId: query.organizationId,
      projectId: project?.id,
      since: range.from,
      until: range.to
    },
    0,
    { excludeNoise: true }
  );
  const byLines = teamLeaderboard;
  const byCommits = [...teamLeaderboard].sort((a, b) => b.commits - a.commits || b.effectiveLines - a.effectiveLines);
  const linesRank = byLines.findIndex((row) => row.employeeId === query.userId);
  const commitsRank = byCommits.findIndex((row) => row.employeeId === query.userId);
  const teamComparison =
    linesRank >= 0
      ? {
          teamSize: teamLeaderboard.length,
          byRealWork: { rank: linesRank + 1, of: teamLeaderboard.length },
          byCommits: { rank: commitsRank + 1, of: teamLeaderboard.length }
        }
      : null;

  const dataBlindSpots = [
    "Line and commit counts reflect activity, not difficulty or quality — a hard bug fixed in a few lines can outweigh a large routine change.",
    "Code review, mentoring, pairing, planning, incident response, and helping teammates don't show up in Git — weigh them alongside this.",
    ...(truncated
      ? [`Only the ${APPRAISAL_COMMIT_CAP} most recent updates were analyzed; totals for a very long, busy window may be partial.`]
      : [])
  ];

  return {
    employee,
    period: { from: range.from, to: range.to, months: query.months, days: periodDays },
    scope: project ? { type: "project" as const, name: project.name } : { type: "organization" as const },
    hasGitIdentity: true,
    truncated,
    headline: {
      commits: commits.length,
      effectiveLines,
      rawLines,
      activeDays: activeDayKeys.size,
      firstCommitAt,
      lastCommitAt
    },
    consistency: {
      // Clamp: a commit on the final partial week can push the index one past
      // totalWeeks, so cap both so the percentage never reads >100%.
      activeWeeks: Math.min(activeWeekIndexes.size, totalWeeks),
      totalWeeks,
      activeWeekPct: Math.min(100, Math.round((activeWeekIndexes.size / totalWeeks) * 100)),
      monthly: monthKeys.map((month) => ({
        month,
        commits: monthlyMap.get(month)?.commits ?? 0,
        lines: monthlyMap.get(month)?.lines ?? 0
      }))
    },
    workMix,
    areas,
    ownership: {
      sensitiveAreaCommits,
      moduleBreadth: moduleChanges.size,
      criticalAreas: humanizeAreas([...criticalAreas].map((module) => ({ module })))
    },
    quality: { features, bugFixes, refactors, largeCommits, riskyCommits },
    teamComparison,
    evidence,
    dataBlindSpots
  };
}

export type EvidenceItem = {
  sha: string;
  message: string;
  committedAt: Date;
  category: string;
  lines: number;
  sensitive: boolean;
  url: string;
};
