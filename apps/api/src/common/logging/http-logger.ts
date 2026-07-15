import type { Options as PinoHttpOptions } from "pino-http";

const SECRET_HEADER_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-openclaw-key']",
  "req.headers['x-openclaw-context']"
];

/**
 * Keep request metadata useful while ensuring credentials never reach stdout or
 * a downstream log collector. These paths target pino-http's serialized request
 * object, whose headers are otherwise logged in full.
 */
export const HTTP_LOGGER_OPTIONS: PinoHttpOptions = {
  redact: {
    paths: SECRET_HEADER_PATHS,
    censor: "[REDACTED]"
  }
};
