import { runDueSchedules } from "./schedules.service.js";
import { writeDueSnapshots } from "../analysis/leaderboard-snapshots.js";
import { captureCodeQualitySnapshots } from "../code-quality/snapshots.service.js";

// In-process scheduler: a single API instance drives due schedules. For a
// multi-instance deploy this would move to a shared queue/lock (see Phase E).
const TICK_MS = 60_000;
// Leaderboard snapshots only cover completed periods, so a slow cadence is fine.
const SNAPSHOT_SWEEP_MS = 15 * 60_000;
// Code-quality snapshots are a daily upsert; an hourly sweep is plenty.
const CODE_QUALITY_SWEEP_MS = 60 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastSnapshotSweep = 0;
let lastCodeQualitySweep = 0;

async function tick() {
  if (running) {
    return;
  }
  running = true;
  try {
    const count = await runDueSchedules();
    if (count > 0) {
      console.log(`[scheduler] ran ${count} due schedule(s)`);
    }

    // Phase 3a: sweep leaderboard snapshots on a slow throttle within the tick.
    const now = Date.now();
    if (now - lastSnapshotSweep >= SNAPSHOT_SWEEP_MS) {
      lastSnapshotSweep = now;
      try {
        const written = await writeDueSnapshots();
        if (written > 0) {
          console.log(`[scheduler] wrote ${written} leaderboard snapshot(s)`);
        }
      } catch (error) {
        console.error("[scheduler] snapshot sweep failed", error);
      }
    }

    // Code-quality trend snapshots (SonarQube) on an hourly throttle.
    if (now - lastCodeQualitySweep >= CODE_QUALITY_SWEEP_MS) {
      lastCodeQualitySweep = now;
      try {
        const captured = await captureCodeQualitySnapshots();
        if (captured > 0) {
          console.log(`[scheduler] captured ${captured} code-quality snapshot(s)`);
        }
      } catch (error) {
        console.error("[scheduler] code-quality sweep failed", error);
      }
    }
  } catch (error) {
    console.error("[scheduler] tick failed", error);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (timer) {
    return;
  }
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Kick once shortly after boot so due schedules don't wait a full tick.
  void tick();
  console.log("[scheduler] started (tick every 60s)");
}
