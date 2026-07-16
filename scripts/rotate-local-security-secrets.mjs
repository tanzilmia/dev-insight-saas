import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(SCRIPT_DIR, "../apps/api/.env");
const TEMP_PATH = `${ENV_PATH}.security-rotation.tmp`;
const ROTATED_KEYS = [
  "JWT_ACCESS_SECRET",
  "OPENCLAW_SERVICE_KEY",
  "OPENCLAW_CONTEXT_SIGNING_SECRET",
  "MCP_ACCESS_TOKEN"
];

function newSecret() {
  return randomBytes(48).toString("base64url");
}

export function rotateEnvText(source) {
  let next = source;
  for (const key of ROTATED_KEYS) {
    const line = `${key}="${newSecret()}"`;
    const pattern = new RegExp(`^${key}=.*$`, "m");
    next = pattern.test(next)
      ? next.replace(pattern, line)
      : `${next.trimEnd()}\n${line}\n`;
  }
  return next;
}

async function rotateLocalSecrets() {
  const source = await readFile(ENV_PATH, "utf8");
  const rotated = rotateEnvText(source);

  await writeFile(TEMP_PATH, rotated, { encoding: "utf8", mode: 0o600 });
  await rename(TEMP_PATH, ENV_PATH);
  await chmod(ENV_PATH, 0o600);

  // Never print secret values. Names are enough for an operator audit trail.
  console.log(`Rotated local security secrets: ${ROTATED_KEYS.join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await rotateLocalSecrets();
}
