import type { CommitCategory } from "../report-engine/commit-classifier.js";

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
  moduleFromPath
} from "../report-engine/commit-classifier.js";
import { resolvePeriod } from "../openclaw/openclaw.tools.js";
import { toLocalDateKey } from "../statistics/statistics.service.js";
import type {
  EmployeeCommitsQuery,
  ProjectAnalysisQuery,
  ProjectBranchesQuery
} from "./analysis.schemas.js";

/** Commit-where fragment for an optional branch-name filter (CommitBranch). */
function branchFilter(branch: string | undefined) {
  return branch ? { branches: { some: { branch: { name: branch } } } } : {};
}

// Single-pass caps: one bounded read for the whole project window instead of
// re-querying per employee. When hit, the response says so (`truncated`).
const ANALYSIS_PAGE_COMMIT_CAP = 2000;
const ANALYSIS_PAGE_FILE_CAP = 10_000;
const LARGE_COMMIT_THRESHOLD = 400;
const SAMPLE_MESSAGES_PER_EMPLOYEE = 3;
const TOP_MODULES_PER_EMPLOYEE = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
// Per-employee detail table + report-prompt signal caps.
const EMPLOYEE_COMMITS_CAP = 100;
const SIGNALS_COMMIT_CAP = 1000;
const SIGNALS_FILE_CAP = 5000;

type EmployeeBucket = {
  userId: string;
  name: string;
  email: string;
  projectRole: string;
  usernames: string[];
  hasGitIdentity: boolean;
  commits: number;
  additions: number;
  deletions: number;
  filteredLines: number;
  excludedLines: number;
  activeDayKeys: Set<string>;
  moduleChanges: Map<string, number>;
  categories: Partial<Record<CommitCategory, number>>;
  riskyCommits: number;
  largeCommits: number;
  lastCommitAt: Date | null;
  sampleMessages: string[];
};

type UnmappedBucket = {
  name: string;
  commits: number;
  filteredLines: number;
};

function firstLine(message: string, max = 120): string {
  const line = (message.split("\n")[0] ?? "").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Per-employee activity signals for one project over a period — the Analysis
 * page's data. Manager-only: this is the comparative view the product keeps
 * away from EMPLOYEE accounts. Reads only stored commits (never hits Git), and
 * ranks by NOISE-FILTERED line counts (lockfiles/generated files excluded) so
 * a dependency bump can't inflate anyone's numbers. These are activity
 * signals, not performance verdicts — the UI carries the same disclaimer.
 */
export async function getProjectAnalysis(actorId: string, query: ProjectAnalysisQuery) {
  await requireOrganizationRole(actorId, query.organizationId, MANAGER_ROLES);

  const project = await prisma.project.findFirst({
    where: { id: query.projectId, organizationId: query.organizationId },
    select: { id: true, name: true }
  });
  if (!project) {
    throw new AppError(404, "Project was not found", "PROJECT_NOT_FOUND");
  }

  const { from, to } = resolvePeriod(
    query.period,
    query.from && query.to ? { from: query.from, to: query.to } : undefined
  );

  const members = await prisma.projectMember.findMany({
    where: { projectId: project.id },
    include: { user: { select: { id: true, name: true, email: true } } }
  });

  // Mapped git usernames per member (same source the leaderboard folds by).
  const mappings = members.length
    ? await prisma.employeeGitMapping.findMany({
        where: {
          organizationId: query.organizationId,
          userId: { in: members.map((member) => member.userId) }
        },
        include: { contributorIdentity: { select: { username: true } } }
      })
    : [];

  const userIdByUsername = new Map<string, string>();
  const usernamesByUserId = new Map<string, string[]>();
  for (const mapping of mappings) {
    const username = mapping.contributorIdentity.username?.toLowerCase();
    if (!username) {
      continue;
    }
    userIdByUsername.set(username, mapping.userId);
    const list = usernamesByUserId.get(mapping.userId) ?? [];
    if (!list.includes(username)) {
      list.push(username);
    }
    usernamesByUserId.set(mapping.userId, list);
  }

  const buckets = new Map<string, EmployeeBucket>();
  for (const member of members) {
    const usernames = usernamesByUserId.get(member.userId) ?? [];
    buckets.set(member.userId, {
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      projectRole: member.role,
      usernames,
      hasGitIdentity: usernames.length > 0,
      commits: 0,
      additions: 0,
      deletions: 0,
      filteredLines: 0,
      excludedLines: 0,
      activeDayKeys: new Set(),
      moduleChanges: new Map(),
      categories: {},
      riskyCommits: 0,
      largeCommits: 0,
      lastCommitAt: null,
      sampleMessages: []
    });
  }

  // Single pass over the project's commits + files for the window.
  const commits = await prisma.commit.findMany({
    where: {
      repository: { organizationId: query.organizationId, projectId: project.id },
      committedAt: { gte: from, lte: to },
      ...branchFilter(query.branch)
    },
    orderBy: { committedAt: "desc" },
    take: ANALYSIS_PAGE_COMMIT_CAP,
    select: {
      id: true,
      message: true,
      username: true,
      authorEmail: true,
      authorName: true,
      committedAt: true,
      additions: true,
      deletions: true
    }
  });

  const files = commits.length
    ? await prisma.changedFile.findMany({
        where: { commitId: { in: commits.map((commit) => commit.id) } },
        select: { commitId: true, filePath: true, additions: true, deletions: true },
        take: ANALYSIS_PAGE_FILE_CAP
      })
    : [];
  const filesByCommit = new Map<string, typeof files>();
  for (const file of files) {
    const list = filesByCommit.get(file.commitId) ?? [];
    list.push(file);
    filesByCommit.set(file.commitId, list);
  }

  const truncated =
    commits.length >= ANALYSIS_PAGE_COMMIT_CAP || files.length >= ANALYSIS_PAGE_FILE_CAP;

  const unmapped = new Map<string, UnmappedBucket>();
  let totalCommits = 0;
  let totalFilteredLines = 0;
  let totalRawLines = 0;

  for (const commit of commits) {
    totalCommits += 1;
    totalRawLines += commit.additions + commit.deletions;

    let commitFilteredLines = 0;
    let commitExcludedLines = 0;
    const commitFiles = filesByCommit.get(commit.id) ?? [];
    for (const file of commitFiles) {
      const lines = file.additions + file.deletions;
      if (isNoisePath(file.filePath)) {
        commitExcludedLines += lines;
      } else {
        commitFilteredLines += lines;
      }
    }
    totalFilteredLines += commitFilteredLines;

    const username = commit.username?.toLowerCase() ?? null;
    const userId = username ? userIdByUsername.get(username) : undefined;
    const bucket = userId ? buckets.get(userId) : undefined;

    if (!bucket) {
      // Activity in the project that no project member owns — surfaced, not
      // hidden, so management sees the mapping gap.
      const key =
        username ??
        commit.authorEmail?.toLowerCase() ??
        commit.authorName?.toLowerCase() ??
        "unknown";
      const display = commit.username ?? commit.authorName ?? commit.authorEmail ?? "Unknown";
      const row = unmapped.get(key) ?? { name: display, commits: 0, filteredLines: 0 };
      row.commits += 1;
      row.filteredLines += commitFilteredLines;
      unmapped.set(key, row);
      continue;
    }

    bucket.commits += 1;
    bucket.additions += commit.additions;
    bucket.deletions += commit.deletions;
    bucket.filteredLines += commitFilteredLines;
    bucket.excludedLines += commitExcludedLines;
    bucket.activeDayKeys.add(toLocalDateKey(commit.committedAt));

    const category = classifyCommit(commit.message);
    bucket.categories[category] = (bucket.categories[category] ?? 0) + 1;
    if (hasRiskKeyword(commit.message)) {
      bucket.riskyCommits += 1;
    }
    if (commit.additions + commit.deletions > LARGE_COMMIT_THRESHOLD) {
      bucket.largeCommits += 1;
    }
    for (const file of commitFiles) {
      if (!isNoisePath(file.filePath)) {
        const bucketName = moduleFromPath(file.filePath);
        bucket.moduleChanges.set(
          bucketName,
          (bucket.moduleChanges.get(bucketName) ?? 0) + file.additions + file.deletions
        );
      }
    }
    // Commits arrive newest-first, so the first hits are the freshest.
    if (!bucket.lastCommitAt) {
      bucket.lastCommitAt = commit.committedAt;
    }
    if (bucket.sampleMessages.length < SAMPLE_MESSAGES_PER_EMPLOYEE) {
      bucket.sampleMessages.push(firstLine(commit.message));
    }
  }

  const employees = [...buckets.values()]
    .sort(
      (a, b) => b.filteredLines - a.filteredLines || b.commits - a.commits
    )
    .map((bucket, index) => ({
      rank: index + 1,
      userId: bucket.userId,
      name: bucket.name,
      email: bucket.email,
      projectRole: bucket.projectRole,
      usernames: bucket.usernames,
      hasGitIdentity: bucket.hasGitIdentity,
      commits: bucket.commits,
      additions: bucket.additions,
      deletions: bucket.deletions,
      lines: bucket.additions + bucket.deletions,
      filteredLines: bucket.filteredLines,
      excludedLines: bucket.excludedLines,
      activeDays: bucket.activeDayKeys.size,
      moduleCount: bucket.moduleChanges.size,
      topModules: [...bucket.moduleChanges.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_MODULES_PER_EMPLOYEE)
        .map(([module]) => module),
      categories: bucket.categories,
      riskyCommits: bucket.riskyCommits,
      largeCommits: bucket.largeCommits,
      lastCommitAt: bucket.lastCommitAt,
      sampleMessages: bucket.sampleMessages
    }));

  const daysInPeriod = Math.max(
    1,
    Math.ceil((to.getTime() - from.getTime() + 1) / DAY_MS)
  );

  return {
    period: { from, to },
    project,
    daysInPeriod,
    truncated,
    totals: {
      commits: totalCommits,
      filteredLines: totalFilteredLines,
      rawLines: totalRawLines,
      activeContributors: employees.filter((employee) => employee.commits > 0).length,
      members: members.length
    },
    employees,
    unmapped: [...unmapped.values()].sort(
      (a, b) => b.filteredLines - a.filteredLines || b.commits - a.commits
    )
  };
}

/**
 * One employee's commits in a project window — the Analysis page's details
 * table. Manager-only. Matching is by the employee's mapped git usernames, the
 * same mechanism the cards use; no mapped identity → empty list.
 */
export async function getEmployeeCommits(actorId: string, query: EmployeeCommitsQuery) {
  await requireOrganizationRole(actorId, query.organizationId, MANAGER_ROLES);

  const project = await prisma.project.findFirst({
    where: { id: query.projectId, organizationId: query.organizationId },
    select: { id: true }
  });
  if (!project) {
    throw new AppError(404, "Project was not found", "PROJECT_NOT_FOUND");
  }

  const { from, to } = resolvePeriod(
    query.period,
    query.from && query.to ? { from: query.from, to: query.to } : undefined
  );

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
  if (!usernames.length) {
    return [];
  }

  const commits = await prisma.commit.findMany({
    where: {
      repository: { organizationId: query.organizationId, projectId: project.id },
      committedAt: { gte: from, lte: to },
      username: { in: usernames, mode: "insensitive" },
      ...branchFilter(query.branch)
    },
    orderBy: { committedAt: "desc" },
    take: EMPLOYEE_COMMITS_CAP,
    select: {
      sha: true,
      message: true,
      committedAt: true,
      additions: true,
      deletions: true,
      changedFilesCount: true
    }
  });

  return commits.map((commit) => ({
    sha: commit.sha.slice(0, 7),
    message: firstLine(commit.message, 140),
    committedAt: commit.committedAt,
    category: classifyCommit(commit.message),
    additions: commit.additions,
    deletions: commit.deletions,
    changedFilesCount: commit.changedFilesCount
  }));
}

/**
 * Lightweight per-employee focus signals (top commit categories + top modules)
 * for a project window, keyed by userId. Feeds the report prompt so the LLM's
 * "Who did what" section can say WHAT each person focused on, not just how
 * much. Kept separate from getProjectAnalysis (no access checks — callers
 * gate) and safe to fail: report generation treats it as optional.
 */
export async function buildProjectEmployeeSignals(
  organizationId: string,
  projectId: string,
  from: Date,
  until: Date
): Promise<Map<string, { topCategories: string[]; topModules: string[] }>> {
  // Org-wide mapping (not just project members) so signals line up with the
  // leaderboard rows, which fold by the same org-wide mappings.
  const mappings = await prisma.employeeGitMapping.findMany({
    where: { organizationId },
    include: { contributorIdentity: { select: { username: true } } }
  });
  const userIdByUsername = new Map<string, string>();
  for (const mapping of mappings) {
    const username = mapping.contributorIdentity.username?.toLowerCase();
    if (username) {
      userIdByUsername.set(username, mapping.userId);
    }
  }
  if (!userIdByUsername.size) {
    return new Map();
  }

  const commits = await prisma.commit.findMany({
    where: {
      repository: { organizationId, projectId },
      committedAt: { gte: from, lte: until }
    },
    orderBy: { committedAt: "desc" },
    take: SIGNALS_COMMIT_CAP,
    select: { id: true, message: true, username: true }
  });

  const categoriesByUser = new Map<string, Map<string, number>>();
  const userIdByCommitId = new Map<string, string>();
  for (const commit of commits) {
    const userId = commit.username
      ? userIdByUsername.get(commit.username.toLowerCase())
      : undefined;
    if (!userId) {
      continue;
    }
    userIdByCommitId.set(commit.id, userId);
    const tally = categoriesByUser.get(userId) ?? new Map<string, number>();
    const category = classifyCommit(commit.message);
    tally.set(category, (tally.get(category) ?? 0) + 1);
    categoriesByUser.set(userId, tally);
  }
  if (!userIdByCommitId.size) {
    return new Map();
  }

  const files = await prisma.changedFile.findMany({
    where: { commitId: { in: [...userIdByCommitId.keys()] } },
    select: { commitId: true, filePath: true, changes: true },
    take: SIGNALS_FILE_CAP
  });
  const modulesByUser = new Map<string, Map<string, number>>();
  for (const file of files) {
    if (isNoisePath(file.filePath)) {
      continue;
    }
    const userId = userIdByCommitId.get(file.commitId)!;
    const tally = modulesByUser.get(userId) ?? new Map<string, number>();
    const moduleName = moduleFromPath(file.filePath);
    tally.set(moduleName, (tally.get(moduleName) ?? 0) + (file.changes || 0));
    modulesByUser.set(userId, tally);
  }

  const topOf = (tally: Map<string, number> | undefined, format: (k: string, v: number) => string) =>
    [...(tally ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, value]) => format(key, value));

  const signals = new Map<string, { topCategories: string[]; topModules: string[] }>();
  for (const userId of categoriesByUser.keys()) {
    signals.set(userId, {
      topCategories: topOf(categoriesByUser.get(userId), (key, value) => `${value} ${key}`),
      topModules: topOf(modulesByUser.get(userId), (key) => key)
    });
  }
  return signals;
}

/**
 * Distinct branch names across the project's repositories — the Analysis
 * page's branch selector. Default branches sort first, then by name.
 */
export async function getProjectBranches(actorId: string, query: ProjectBranchesQuery) {
  await requireOrganizationRole(actorId, query.organizationId, MANAGER_ROLES);

  const project = await prisma.project.findFirst({
    where: { id: query.projectId, organizationId: query.organizationId },
    select: { id: true }
  });
  if (!project) {
    throw new AppError(404, "Project was not found", "PROJECT_NOT_FOUND");
  }

  const rows = await prisma.branch.findMany({
    where: { repository: { organizationId: query.organizationId, projectId: project.id } },
    select: { name: true, isDefault: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }]
  });

  const seen = new Map<string, { name: string; isDefault: boolean }>();
  for (const row of rows) {
    const existing = seen.get(row.name);
    if (!existing) {
      seen.set(row.name, { name: row.name, isDefault: row.isDefault });
    } else if (row.isDefault && !existing.isDefault) {
      existing.isDefault = true;
    }
  }

  return [...seen.values()];
}
