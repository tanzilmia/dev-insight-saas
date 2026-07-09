import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { startScheduler } from "./modules/schedules/scheduler.js";

const app = createApp();
const port = env.PORT;

app.listen(port, () => {
  console.log(`DevInsight API listening on port ${port}`);
  startScheduler();
});
