import { runDueSchedules } from "./schedules.service.js";

// In-process scheduler: a single API instance drives due schedules. For a
// multi-instance deploy this would move to a shared queue/lock (see Phase E).
const TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

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
