import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startScheduler } from "./modules/schedules/scheduler.js";
import { startCollectionWorker } from "./modules/activity/collection-worker.js";

const app = createApp();
const port = env.PORT;

app.listen(port, () => {
  console.log(`DevInsight API listening on port ${port}`);
  startScheduler();
  startCollectionWorker();
});
