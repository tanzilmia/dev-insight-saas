import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEVINSIGHT_ENV_PATH = resolve(SCRIPT_DIR, "../apps/api/.env");
const targetArgument = process.argv[2];

if (!targetArgument) {
  throw new Error("Usage: sync-openclaw-mcp-token.mjs <openclaw-env-path>");
}

const targetPath = resolve(targetArgument);
const temporaryPath = `${targetPath}.devinsight-mcp-sync.tmp`;
const [devInsightEnv, openClawEnv] = await Promise.all([
  readFile(DEVINSIGHT_ENV_PATH, "utf8"),
  readFile(targetPath, "utf8")
]);
const token = devInsightEnv.match(/^MCP_ACCESS_TOKEN="?([^"\n]+)"?$/m)?.[1];

if (!token) {
  throw new Error("MCP_ACCESS_TOKEN is missing from apps/api/.env");
}

const key = "DEVINSIGHT_MCP_TOKEN";
const nextLine = `${key}="${token}"`;
const pattern = new RegExp(`^${key}=.*$`, "m");
const updated = pattern.test(openClawEnv)
  ? openClawEnv.replace(pattern, nextLine)
  : `${openClawEnv.trimEnd()}\n${nextLine}\n`;

await writeFile(temporaryPath, updated, { encoding: "utf8", mode: 0o600 });
await rename(temporaryPath, targetPath);
await chmod(targetPath, 0o600);

console.log("Synchronized DEVINSIGHT_MCP_TOKEN into the OpenClaw environment");
