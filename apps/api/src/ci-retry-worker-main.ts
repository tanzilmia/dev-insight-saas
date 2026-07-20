import { env } from "./config/env.js";
import { startCiRetryWorker } from "./modules/ci/ci-retry.service.js";

if (env.CI_AUTO_RETRY_ENABLED) {
  startCiRetryWorker();
} else {
  console.log("[ci-retry] worker disabled; set CI_AUTO_RETRY_ENABLED=true to enable it");
}

// Keep an intentionally disabled worker alive so Compose does not restart-loop
// while operators roll the feature out through environment configuration.
setInterval(() => {}, 60 * 60 * 1000);
