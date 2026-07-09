import type { ReportSchedule, ScheduleCadence } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { orchestrateReport } from "../openclaw/openclaw.service.js";
import type { GenerateReportInput, Period, ReportType } from "../openclaw/openclaw.schemas.js";
import type { CreateScheduleInput, UpdateScheduleInput } from "./schedules.schemas.js";

// Bound how many due schedules a single scheduler tick runs.
const MAX_PER_TICK = 20;

/** Next fire time for a cadence, measured from `from`. */
export function computeNextRun(from: Date, cadence: ScheduleCadence): Date {
  if (cadence === "DAILY") {
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, from.getHours(), from.getMinutes());
  }
  if (cadence === "WEEKLY") {
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7, from.getHours(), from.getMinutes());
  }
  return new Date(from.getFullYear(), from.getMonth() + 1, from.getDate(), from.getHours(), from.getMinutes());
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
  await loadOwnedSchedule(actorId, id);

  const updated = await prisma.reportSchedule.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      period: input.period ?? undefined,
      cadence: input.cadence ?? undefined,
      customPrompt: input.customPrompt === undefined ? undefined : input.customPrompt,
      enabled: input.enabled ?? undefined,
      // Re-anchor the next run when the cadence changes.
      nextRunAt: input.cadence ? computeNextRun(new Date(), input.cadence) : undefined
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
 * scheduler. Advances nextRunAt even on failure so a broken schedule doesn't
 * retry every tick; the error is recorded on the row.
 */
export async function runDueSchedules(now: Date = new Date()) {
  const due = await prisma.reportSchedule.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: MAX_PER_TICK
  });

  for (const schedule of due) {
    const nextRunAt = computeNextRun(now, schedule.cadence);
    try {
      const report = await executeSchedule(schedule);
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: now, nextRunAt, lastReportId: report.reportId, lastStatus: "ok", lastError: null }
      });
    } catch (error) {
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: now,
          nextRunAt,
          lastStatus: "error",
          lastError: (error as Error).message.slice(0, 500)
        }
      });
    }
  }

  return due.length;
}
