import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import {
  buildEmployeeLeaderboard,
  type EmployeeLeaderboardRow
} from "../activity/activity.service.js";
import { getLLMProvider } from "../llm/llm-registry.js";
import type { ChatMessage } from "../llm/llm-provider.js";
import { toLocalDateKey } from "../statistics/statistics.service.js";
import { monthRange } from "./leaderboard-snapshots.js";
import type { AwardShortlistInput, AwardsQuery } from "./analysis.schemas.js";

const SHORTLIST_SIZE = 5;
// Balanced, transparent weighting — volume, breadth, and consistency, so a
// single huge commit can't outrank steady, broad work. Shown in the UI.
const WEIGHTS = { commits: 0.3, lines: 0.3, activeDays: 0.25, filesChanged: 0.15 };

type Candidate = {
  userId: string;
  name: string;
  usernames: string[];
  commits: number;
  lines: number;
  filesChanged: number;
  activeDays: number;
  sampleMessages: string[];
  score: number;
  rank: number;
};

/** Resolves the target month range + label from an optional "YYYY-MM" key. */
function resolveMonth(periodKey?: string): { periodKey: string; rangeStart: Date; rangeEnd: Date } {
  if (periodKey) {
    const [year, month] = periodKey.split("-").map(Number);
    const range = monthRange(new Date(year!, month! - 1, 15));
    return { periodKey: range.periodKey, rangeStart: range.rangeStart, rangeEnd: range.rangeEnd };
  }
  // Default: the last completed calendar month.
  const now = new Date();
  const range = monthRange(new Date(now.getFullYear(), now.getMonth() - 1, 15));
  return { periodKey: range.periodKey, rangeStart: range.rangeStart, rangeEnd: range.rangeEnd };
}

/** Active-day count per candidate (distinct local commit days over the month). */
async function activeDaysByEmployee(
  organizationId: string,
  rows: EmployeeLeaderboardRow[],
  since: Date,
  until: Date
): Promise<Map<string, number>> {
  const usernames = [...new Set(rows.flatMap((r) => r.usernames))];
  const result = new Map<string, number>();
  if (!usernames.length) {
    return result;
  }

  const commits = await prisma.commit.findMany({
    where: {
      repository: { organizationId },
      username: { in: usernames },
      committedAt: { gte: since, lte: until }
    },
    select: { username: true, committedAt: true }
  });
  const daysByUsername = new Map<string, Set<string>>();
  for (const commit of commits) {
    if (!commit.username) continue;
    const set = daysByUsername.get(commit.username) ?? new Set<string>();
    set.add(toLocalDateKey(commit.committedAt));
    daysByUsername.set(commit.username, set);
  }

  for (const row of rows) {
    if (!row.employeeId) continue;
    const days = new Set<string>();
    for (const username of row.usernames) {
      for (const key of daysByUsername.get(username) ?? []) days.add(key);
    }
    result.set(row.employeeId, days.size);
  }
  return result;
}

function scoreCandidates(
  rows: EmployeeLeaderboardRow[],
  activeDays: Map<string, number>
): Candidate[] {
  const mapped = rows.filter((r) => r.employeeId);
  if (!mapped.length) {
    return [];
  }
  const maxOf = (pick: (r: EmployeeLeaderboardRow) => number) =>
    Math.max(1, ...mapped.map(pick));
  const maxCommits = maxOf((r) => r.commits);
  const maxLines = maxOf((r) => r.lines);
  const maxFiles = maxOf((r) => r.filesChanged);
  const maxDays = Math.max(1, ...mapped.map((r) => activeDays.get(r.employeeId!) ?? 0));

  const scored = mapped.map((r) => {
    const days = activeDays.get(r.employeeId!) ?? 0;
    const score =
      WEIGHTS.commits * (r.commits / maxCommits) +
      WEIGHTS.lines * (r.lines / maxLines) +
      WEIGHTS.activeDays * (days / maxDays) +
      WEIGHTS.filesChanged * (r.filesChanged / maxFiles);
    return {
      userId: r.employeeId!,
      name: r.name,
      usernames: r.usernames,
      commits: r.commits,
      lines: r.lines,
      filesChanged: r.filesChanged,
      activeDays: days,
      sampleMessages: r.sampleMessages,
      score: Math.round(score * 1000) / 1000,
      rank: 0
    };
  });

  scored.sort((a, b) => b.score - a.score || b.lines - a.lines);
  return scored.slice(0, SHORTLIST_SIZE).map((c, i) => ({ ...c, rank: i + 1 }));
}

function templateCitation(c: Candidate): string {
  const focus = c.sampleMessages[0] ? ` Recent work: “${c.sampleMessages[0]}”.` : "";
  return (
    `${c.name} shipped ${c.commits} commit${c.commits === 1 ? "" : "s"} ` +
    `(${c.lines.toLocaleString()} lines across ${c.filesChanged} file${c.filesChanged === 1 ? "" : "s"}) ` +
    `on ${c.activeDays} active day${c.activeDays === 1 ? "" : "s"}.${focus}`
  );
}

/**
 * Best-effort LLM citations: one call for the whole shortlist, parsed by an
 * index marker ("1) …"). Any candidate the model skips keeps its template
 * citation, so a partial or failed response never leaves a blank.
 */
async function generateCitations(
  candidates: Candidate[],
  monthLabel: string
): Promise<{ citations: string[]; generatedBy: "llm" | "template" }> {
  const templates = candidates.map(templateCitation);
  const llm = getLLMProvider();
  if (!llm.available || !candidates.length) {
    return { citations: templates, generatedBy: "template" };
  }

  const roster = candidates
    .map((c, i) => {
      const work = c.sampleMessages.slice(0, 4).map((m) => `"${m}"`).join("; ") || "(no messages)";
      return `${i + 1}) ${c.name}: ${c.commits} commits, ${c.lines} lines, ${c.activeDays} active days. Recent: ${work}`;
    })
    .join("\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You write brief, factual recognition citations for a work-activity report. " +
        "One sentence per person, grounded ONLY in the provided numbers and commit messages. " +
        "Never invent work, praise vaguely, or compare people. Return exactly one line per " +
        "person, each prefixed with its number and a close-paren, e.g. '1) ...'."
    },
    {
      role: "user",
      content: `Month: ${monthLabel}. Write a one-sentence citation for each contributor:\n${roster}`
    }
  ];

  try {
    const text = await llm.complete(messages);
    const byIndex = new Map<number, string>();
    for (const line of text.split("\n")) {
      const match = line.match(/^\s*(\d+)[).]\s*(.+)$/);
      if (match) {
        byIndex.set(Number(match[1]), match[2]!.trim());
      }
    }
    const citations = candidates.map((_, i) => byIndex.get(i + 1) ?? templates[i]!);
    const anyFromLlm = candidates.some((_, i) => byIndex.has(i + 1));
    return { citations, generatedBy: anyFromLlm ? "llm" : "template" };
  } catch (error) {
    console.warn("Award citation LLM call failed; using templates.", error);
    return { citations: templates, generatedBy: "template" };
  }
}

/**
 * Generates an employee-of-the-month shortlist for a scope + month (Phase 4b),
 * manager-gated. Deterministic score ranks mapped employees; the LLM (or a
 * template) writes each citation. Replaces any prior SHORTLISTED rows for the
 * same scope+period; CONFIRMED/DISMISSED history is preserved.
 */
export async function generateShortlist(actorId: string, input: AwardShortlistInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  const month = resolveMonth(input.periodKey);

  let projectName: string | null = null;
  let projectId: string | undefined;
  if (input.scope !== "org") {
    const project = await prisma.project.findFirst({
      where: { id: input.scope, organizationId: input.organizationId },
      select: { id: true, name: true }
    });
    if (!project) {
      throw new AppError(404, "Project was not found", "PROJECT_NOT_FOUND");
    }
    projectName = project.name;
    projectId = project.id;
  }

  const leaderboard = await buildEmployeeLeaderboard(
    {
      organizationId: input.organizationId,
      projectId,
      since: month.rangeStart,
      until: month.rangeEnd
    },
    5
  );
  const activeDays = await activeDaysByEmployee(
    input.organizationId,
    leaderboard,
    month.rangeStart,
    month.rangeEnd
  );
  const candidates = scoreCandidates(leaderboard, activeDays);
  const { citations, generatedBy } = await generateCitations(candidates, month.periodKey);

  const awards = await prisma.$transaction(async (tx) => {
    await tx.employeeAward.deleteMany({
      where: {
        organizationId: input.organizationId,
        scope: input.scope,
        periodKey: month.periodKey,
        status: "SHORTLISTED"
      }
    });

    const created = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i]!;
      created.push(
        await tx.employeeAward.create({
          data: {
            organizationId: input.organizationId,
            scope: input.scope,
            projectName,
            periodKey: month.periodKey,
            rangeStart: month.rangeStart,
            rangeEnd: month.rangeEnd,
            userId: c.userId,
            name: c.name,
            usernames: c.usernames,
            rank: c.rank,
            score: c.score,
            commits: c.commits,
            lines: c.lines,
            activeDays: c.activeDays,
            filesChanged: c.filesChanged,
            citation: citations[i]!,
            generatedBy,
            createdById: actorId
          }
        })
      );
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId,
        action: "analysis.award.shortlist",
        entityType: "EmployeeAward",
        metadataJson: {
          scope: input.scope,
          periodKey: month.periodKey,
          candidates: candidates.length,
          generatedBy
        }
      }
    });

    return created;
  });

  return { periodKey: month.periodKey, scope: input.scope, projectName, generatedBy, awards };
}

/**
 * Confirms one shortlisted award as the winner (manager-gated). Its siblings in
 * the same scope+period are moved to DISMISSED so there is a single winner.
 */
export async function confirmAward(actorId: string, awardId: string) {
  const award = await prisma.employeeAward.findUnique({ where: { id: awardId } });
  if (!award) {
    throw new AppError(404, "Award was not found", "AWARD_NOT_FOUND");
  }
  await requireOrganizationRole(actorId, award.organizationId, MANAGER_ROLES);

  return prisma.$transaction(async (tx) => {
    await tx.employeeAward.updateMany({
      where: {
        organizationId: award.organizationId,
        scope: award.scope,
        periodKey: award.periodKey,
        status: "SHORTLISTED",
        id: { not: award.id }
      },
      data: { status: "DISMISSED" }
    });

    const confirmed = await tx.employeeAward.update({
      where: { id: award.id },
      data: { status: "CONFIRMED", confirmedById: actorId, confirmedAt: new Date() }
    });

    await tx.auditLog.create({
      data: {
        organizationId: award.organizationId,
        actorId,
        action: "analysis.award.confirm",
        entityType: "EmployeeAward",
        entityId: award.id,
        metadataJson: { scope: award.scope, periodKey: award.periodKey, userId: award.userId }
      }
    });

    return confirmed;
  });
}

/** Lists awards for a scope (member-gated), newest period first. */
export async function listAwards(actorId: string, query: AwardsQuery) {
  await requireOrganizationMember(actorId, query.organizationId);

  return prisma.employeeAward.findMany({
    where: {
      organizationId: query.organizationId,
      ...(query.scope ? { scope: query.scope } : {})
    },
    orderBy: [{ periodKey: "desc" }, { rank: "asc" }],
    take: query.limit
  });
}
