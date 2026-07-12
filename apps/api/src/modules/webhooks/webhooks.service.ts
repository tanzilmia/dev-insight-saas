import { createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "../../config/database.js";
import { decryptToken } from "../../common/crypto/token-cipher.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
import { ingestRepository } from "../activity/activity.service.js";

// Ingest window starts a little before the earliest pushed commit so clock
// drift between GitHub and commit timestamps can't drop anything.
const PUSH_WINDOW_BUFFER_MS = 5 * 60 * 1000;

/** Push payload fields we read — GitHub sends far more; the rest is ignored. */
type PushPayload = {
  commits?: { timestamp?: string }[];
  head_commit?: { timestamp?: string } | null;
};

/** Constant-time HMAC check of GitHub's X-Hub-Signature-256 header. */
export function verifySignature(rawBody: Buffer, secret: string, header: string | undefined) {
  if (!header?.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);
  if (received.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

// Per-repo debounce: one ingest at a time; rapid pushes coalesce into a single
// trailing re-run instead of stacking concurrent collections.
const running = new Set<string>();
const trailing = new Set<string>();

function pushWindowStart(payload: PushPayload): Date {
  const timestamps = [
    ...(payload.commits ?? []).map((commit) => commit.timestamp),
    payload.head_commit?.timestamp
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  const earliest = timestamps.length ? Math.min(...timestamps) : Date.now();
  return new Date(earliest - PUSH_WINDOW_BUFFER_MS);
}

/**
 * Fire-and-forget ingest for a verified push delivery. Never throws — the
 * webhook already answered 202; failures mark the repo's live-sync status so
 * the UI can surface them.
 */
export async function handlePushDelivery(repositoryId: string, payload: PushPayload) {
  if (running.has(repositoryId)) {
    trailing.add(repositoryId);
    return;
  }
  running.add(repositoryId);

  try {
    do {
      trailing.delete(repositoryId);

      const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
      if (!repository) {
        return;
      }
      const credential = await prisma.gitCredential.findUnique({
        where: { id: repository.credentialId }
      });
      if (!credential) {
        return;
      }

      const token = decryptToken(credential.encryptedToken);
      const provider = getGitProvider(credential.provider);
      await ingestRepository(repository, token, provider, pushWindowStart(payload), new Date());

      await prisma.repository.update({
        where: { id: repositoryId },
        data: { lastWebhookAt: new Date(), webhookStatus: "ACTIVE" }
      });
    } while (trailing.has(repositoryId));
  } catch (error) {
    console.warn(`[webhooks] push ingest failed for repository ${repositoryId}`, error);
    await prisma.repository
      .update({ where: { id: repositoryId }, data: { webhookStatus: "ERROR" } })
      .catch(() => {});
  } finally {
    running.delete(repositoryId);
  }
}
