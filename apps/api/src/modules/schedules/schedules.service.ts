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
import { deliverReportForSchedule } from "../channels/channels.service.js";
import type { CreateScheduleInput, UpdateScheduleInput } from "./schedules.schemas.js";

// Bound how many due schedules a single scheduler tick runs.
const MAX_PER_TICK = 20;

// One quick retry after a transient failure (instead of skipping a whole
// cadence); a second consecutive failure falls back to the normal cadence.
const RETRY_DELAY_MS = 5 * 60 * 1000;

// The server's own zone, used when a schedule has no explicit timeZone.
const SERVER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export type NextRunSpec = {
  cadence: ScheduleCadence;
  runHour: number;
  runMinute: number;
  timeZone: string | null;
};

/** UTC offset (minutes, east-positive) of `timeZone` at instant `at`. */
function tzOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asUtc - at.getTime()) / 60000;
}

/** The UTC instant of wall-clock Y-M-D H:M in `timeZone` (two passes for DST). */
function zonedWallClockToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = tzOffsetMinutes(timeZone, new Date(naive));
  let utc = naive - offset1 * 60000;
  const offset2 = tzOffsetMinutes(timeZone, new Date(utc));
  if (offset2 !== offset1) {
    utc = naive - offset2 * 60000;
  }
  return new Date(utc);
}

/** Zone-local calendar date of an instant. */
function zonedDate(timeZone: string, at: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Days in a 1-based month (handles month 13 → next January). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Next fire instant at `runHour:runMinute` (interpreted in the schedule's
 * timeZone, DST-correct) for the cadence, strictly after `from`. Uses today's
 * target time; if that's already passed it advances one cadence step (MONTHLY
 * clamps the day so Jan 31 → Feb 28/29 instead of skipping February).
 */
export function computeNextRun(from: Date, spec: NextRunSpec): Date {
  const timeZone = spec.timeZone || SERVER_TIME_ZONE;
  const { year, month, day } = zonedDate(timeZone, from);

  const candidate = zonedWallClockToUtc(timeZone, year, month, day, spec.runHour, spec.runMinute);
  if (candidate.getTime() > from.getTime()) {
    return candidate;
  }

  if (spec.cadence === "DAILY") {
    return zonedWallClockToUtc(timeZone, year, month, day + 1, spec.runHour, spec.runMinute);
  }
  if (spec.cadence === "WEEKLY") {
    return zonedWallClockToUtc(timeZone, year, month, day + 7, spec.runHour, spec.runMinute);
  }
  const nextMonth = month + 1; // 1-based; 13 normalises to next January
  const clampedDay = Math.min(day, daysInMonth(year, nextMonth));
  return zonedWallClockToUtc(timeZone, year, nextMonth, clampedDay, spec.runHour, spec.runMinute);
}

/** Build the next-run spec from a stored schedule row. */
function specOf(schedule: {
  cadence: ScheduleCadence;
  runHour: number;
  runMinute: number;
  timeZone: string | null;
}): NextRunSpec {
  return {
    cadence: schedule.cadence,
    runHour: schedule.runHour,
    runMinute: schedule.runMinute,
    timeZone: schedule.timeZone
  };
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
    runHour: schedule.runHour,
    runMinute: schedule.runMinute,
    timeZone: schedule.timeZone,
    customPrompt: schedule.customPrompt,
    channelId: schedule.channelId,
    enabled: schedule.enabled,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    lastReportId: schedule.lastReportId,
    lastStatus: schedule.lastStatus,
    lastError: schedule.lastError,
    createdAt: schedule.createdAt
  };
}

/** Ensures a delivery channel exists and belongs to this org (404 otherwise). */
async function requireChannelInOrg(organizationId: string, channelId: string) {
  const channel = await prisma.notificationChannel.findUnique({
    where: { id: channelId },
    select: { organizationId: true }
  });
  if (!channel || channel.organizationId !== organizationId) {
    throw new AppError(404, "Delivery channel was not found", "CHANNEL_NOT_FOUND");
  }
}

type ExecutedReport = Awaited<ReturnType<typeof orchestrateReport>>;

/**
 * Delivers a just-generated report to the schedule's channel, if one is set.
 * Resilient: never throws — a delivery failure must not fail the report run.
 * Returns a short status string for logging, or null when no channel is set.
 */
async function deliverScheduleReport(
  schedule: ReportSchedule,
  report: ExecutedReport
): Promise<string | null> {
  if (!schedule.channelId) {
    return null;
  }
  const result = await deliverReportForSchedule(schedule.organizationId, schedule.channelId, {
    title: report.title,
    markdown: report.markdown,
    periodStart: report.period.from,
    periodEnd: report.period.to,
    statistics: report.statistics
  });
  return result.ok ? "delivered" : `delivery failed: ${result.error ?? "unknown"}`;
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
  if (input.channelId) {
    await requireChannelInOrg(input.organizationId, input.channelId);
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
      runHour: input.runHour,
      runMinute: input.runMinute,
      timeZone: input.timeZone ?? null,
      customPrompt: input.customPrompt ?? null,
      channelId: input.channelId ?? null,
      nextRunAt: computeNextRun(now, {
        cadence: input.cadence,
        runHour: input.runHour,
        runMinute: input.runMinute,
        timeZone: input.timeZone ?? null
      })
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

  if (input.channelId) {
    await requireChannelInOrg(existing.organizationId, input.channelId);
  }

  // Re-anchor the next run when the cadence/time/zone changes, or when
  // re-enabling a schedule whose nextRunAt is already in the past — otherwise a
  // long-paused schedule fires on the very next tick.
  const timingChanged =
    input.cadence !== undefined ||
    input.runHour !== undefined ||
    input.runMinute !== undefined ||
    input.timeZone !== undefined;

  let nextRunAt: Date | undefined;
  if (timingChanged) {
    nextRunAt = computeNextRun(now, {
      cadence: input.cadence ?? existing.cadence,
      runHour: input.runHour ?? existing.runHour,
      runMinute: input.runMinute ?? existing.runMinute,
      timeZone: input.timeZone ?? existing.timeZone
    });
  } else if (input.enabled === true && existing.nextRunAt < now) {
    nextRunAt = computeNextRun(now, specOf(existing));
  }

  const updated = await prisma.reportSchedule.update({
    where: { id },
    data: {
      name: input.name ?? undefined,
      period: input.period ?? undefined,
      cadence: input.cadence ?? undefined,
      runHour: input.runHour ?? undefined,
      runMinute: input.runMinute ?? undefined,
      timeZone: input.timeZone === undefined ? undefined : input.timeZone,
      customPrompt: input.customPrompt === undefined ? undefined : input.customPrompt,
      channelId: input.channelId === undefined ? undefined : input.channelId,
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
    const delivery = await deliverScheduleReport(schedule, report);
    await prisma.reportSchedule.update({
      where: { id },
      data: { lastRunAt: now, lastReportId: report.reportId, lastStatus: "ok", lastError: null }
    });
    return { reportId: report.reportId, status: "ok" as const, delivery };
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
    const normalNext = computeNextRun(now, specOf(schedule));

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
      const delivery = await deliverScheduleReport(schedule, report);
      if (delivery && delivery !== "delivered") {
        console.warn(`[scheduler] schedule ${schedule.id} ${delivery}`);
      }
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
