import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROTATED_KEYS = [
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_SERVICE_KEY",
  "MCP_ACCESS_TOKEN",
  "OPENCLAW_CONTEXT_SIGNING_SECRET"
];

function newSecret() {
  return randomBytes(48).toString("base64url");
}

export function rotateOpenClawEnvText(source) {
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

async function rotateProdOpenClawSecrets(targetArgument) {
  if (!targetArgument) {
    throw new Error("Usage: rotate-prod-openclaw-secrets.mjs <production-env-path>");
  }

  const envPath = resolve(targetArgument);
  const temporaryPath = `${envPath}.openclaw-rotation.tmp`;
  const source = await readFile(envPath, "utf8");
  const rotated = rotateOpenClawEnvText(source);

  await writeFile(temporaryPath, rotated, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, envPath);
  await chmod(envPath, 0o600);

  console.log(`Rotated production OpenClaw secrets: ${ROTATED_KEYS.join(", ")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await rotateProdOpenClawSecrets(process.argv[2]);
}
