import type { ReportSchedule, ScheduleCadence } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { orchestrateReport } from "../openclaw/openclaw.service.js";
import {
  resolveEmployees,
  resolveProject,
  resolveRepository
} from "../openclaw/openclaw.tools.js";
import type { GenerateReportInput, Period, ReportType } from "../openclaw/openclaw.schemas.js";
import type { CreateScheduleInput, UpdateScheduleInput } from "./schedules.schemas.js";

// Bound how many due schedules a single scheduler tick runs.
const MAX_PER_TICK = 20;

// One quick retry after a transient failure (instead of skipping a whole
// cadence); a second consecutive failure falls back to the normal cadence.
const RETRY_DELAY_MS = 5 * 60 * 1000;

/** Next fire time for a cadence, measured from `from`. */
export function computeNextRun(from: Date, cadence: ScheduleCadence): Date {
  if (cadence === "DAILY") {
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, from.getHours(), from.getMinutes());
  }
  if (cadence === "WEEKLY") {
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7, from.getHours(), from.getMinutes());
  }
  // MONTHLY: advance one month, clamping the day to the target month's length so
  // Jan 31 → Feb 28/29 instead of overflowing into March (which skips February).
  const targetMonth = from.getMonth() + 1;
  const daysInTargetMonth = new Date(from.getFullYear(), targetMonth + 1, 0).getDate();
  const day = Math.min(from.getDate(), daysInTargetMonth);
  return new Date(from.getFullYear(), targetMonth, day, from.getHours(), from.getMinutes());
}

function serialize(schedule: ReportSchedule) {
  return {
    id: schedule.id,
    name: schedule.name,
    reportType: schedule.reportType,
    repositoryId: schedule.repositoryId,
    projectId: schedule.projectId,
    employeeIds: schedule.employeeIds,
    period: schedule.period,
    cadence: schedule.cadence,
    customPrompt: schedule.customPrompt,
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    lastReportId: schedule.lastReportId,
    lastStatus: schedule.lastStatus,
    lastError: schedule.lastError,
    createdAt: schedule.createdAt
  };
}

export async function createSchedule(actorId: string, input: CreateScheduleInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  // The schema only checks a target is present; make sure it actually belongs to
  // this org (these helpers throw a 404 otherwise) so a foreign or deleted id
  // can't sit in the DB and fail silently when the schedule later runs.
  if (input.repositoryId) {
    await resolveRepository(input.organizationId, input.repositoryId);
  }
  if (input.projectId) {
    await resolveProject(input.organizationId, input.projectId);
  }
  if (input.employeeIds?.length) {
    await resolveEmployees(input.organizationId, input.employeeIds);
  }

  const now = new Date();
  const schedule = await prisma.reportSchedule.create({
    data: {
      organizationId: input.organizationId,
      createdById: actorId,
      name: input.name,
      reportType: input.reportType,
      repositoryId: input.repositoryId ?? null,
      projectId: input.projectId ?? null,
      employeeIds: input.employeeIds ?? [],
      period: input.period,
      cadence: input.cadence,
      customPrompt: input.customPrompt ?? null,
      nextRunAt: computeNextRun(now, input.cadence)
    }
  });

  return serialize(schedule);
}

export async function listSchedules(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);

  const schedules = await prisma.reportSchedule.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" }
  });

  return schedules.map(serialize);
}

async function loadOwnedSchedule(actorId: string, id: string) {
  const schedule = await prisma.reportSchedule.findUnique({ where: { id } });
  if (!schedule) {
    throw new AppError(404, "Schedule was not found", "SCHEDULE_NOT_FOUND");
  }
  await requireOrganizationRole(actorId, schedule.organizationId, MANAGER_ROLES);
  return schedule;
}

export async function updateSchedule(actorId: string, id: string, input: UpdateScheduleInput) {
  const existing = await loadOwnedSchedule(actorId, id);
  const now = new Date();

  // Re-anchor the next run when the cadence changes, or when re-enabling a
  // schedule whose nextRunAt is already in the past — otherwise a long-paused
  // schedule fires on the very next tick.
  let nextRunAt: Date | undefined;
  if (input.cadence) {
    nextRunAt = computeNextRun(now, input.cadence);
  } else if (input.enabled === true && existing.nextRunAt < now) {
    nextRunAt = computeNextRun(now, existing.cadence);
  }

  const updated = await prisma.reportSchedule.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      period: input.period ?? undefined,
      cadence: input.cadence ?? undefined,
      customPrompt: input.customPrompt === undefined ? undefined : input.customPrompt,
      enabled: input.enabled ?? undefined,
      nextRunAt
    }
  });

  return serialize(updated);
}

export async function deleteSchedule(actorId: string, id: string) {
  await loadOwnedSchedule(actorId, id);
  await prisma.reportSchedule.delete({ where: { id } });
  return { id };
}

/** Builds the report request from a schedule and runs it through OpenClaw. */
async function executeSchedule(schedule: ReportSchedule) {
  if (!schedule.createdById) {
    throw new AppError(400, "Schedule has no creator to act as", "SCHEDULE_NO_ACTOR");
  }

  const input: GenerateReportInput = {
    organizationId: schedule.organizationId,
    reportType: schedule.reportType as ReportType,
    period: schedule.period as Period,
    repositoryId: schedule.repositoryId ?? undefined,
    projectId: schedule.projectId ?? undefined,
    employeeIds: schedule.employeeIds.length ? schedule.employeeIds : undefined,
    customPrompt: schedule.customPrompt ?? undefined
  };

  return orchestrateReport(schedule.createdById, input);
}

export async function runScheduleNow(actorId: string, id: string) {
  const schedule = await loadOwnedSchedule(actorId, id);
  const now = new Date();

  try {
    const report = await executeSchedule(schedule);
    await prisma.reportSchedule.update({
      where: { id },
      data: { lastRunAt: now, lastReportId: report.reportId, lastStatus: "ok", lastError: null }
    });
    return { reportId: report.reportId, status: "ok" as const };
  } catch (error) {
    const message = (error as Error).message.slice(0, 500);
    await prisma.reportSchedule.update({
      where: { id },
      data: { lastRunAt: now, lastStatus: "error", lastError: message }
    });
    throw new AppError(502, `Schedule run failed: ${message}`, "SCHEDULE_RUN_FAILED");
  }
}

/**
 * Runs every schedule whose nextRunAt is due. Called by the background
 * scheduler. Each schedule is claimed atomically before it runs (so two API
 * instances can't double-generate the same report), then nextRunAt is advanced
 * on success and on a repeated failure; a first transient failure retries soon.
 */
export async function runDueSchedules(now: Date = new Date()) {
  const due = await prisma.reportSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: MAX_PER_TICK
  });

  let ran = 0;

  for (const schedule of due) {
    const normalNext = computeNextRun(now, schedule.cadence);

    // Claim it: advance nextRunAt conditioned on the value we just read. Only
    // the instance whose update matches (count === 1) proceeds; a second
    // instance (or a concurrent pause/edit) sees count 0 and skips.
    const claim = await prisma.reportSchedule.updateMany({
      where: { id: schedule.id, nextRunAt: schedule.nextRunAt, enabled: true },
      data: { nextRunAt: normalNext }
    });
    if (claim.count === 0) {
      continue;
    }

    ran += 1;

    try {
      const report = await executeSchedule(schedule);
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, lastReportId: report.reportId, lastStatus: "ok", lastError: null }
      });
    } catch (error) {
      // First failure in a streak → retry soon (if that's before the next run);
      // a repeat failure keeps the already-claimed normal cadence.
      const firstFailure = schedule.lastStatus !== "error";
      const retryAt = new Date(now.getTime() + RETRY_DELAY_MS);
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: now,
          nextRunAt: firstFailure && retryAt < normalNext ? retryAt : normalNext,
          lastStatus: "error",
          lastError: (error as Error).message.slice(0, 500)
        }
      });
    }
  }

  return ran;
}
