import { createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "../../config/database.js";
import { decryptToken } from "../../common/crypto/token-cipher.js";
import { getGitProvider } from "../git-providers/provider-registry.js";
import {
  ingestPushedCommits,
  ingestRepository,
  type PushedCommitInput
} from "../activity/activity.service.js";

// Fallback ingest window (payload without a commit list, e.g. odd events):
// re-list the last 48h so date semantics can't drop late-pushed commits.
const FALLBACK_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Push payload fields we read — GitHub sends far more; the rest is ignored. */
type PushPayload = {
  ref?: string;
  commits?: {
    id?: string;
    message?: string;
    timestamp?: string;
    author?: { name?: string; email?: string; username?: string };
  }[];
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

/** "refs/heads/main" → "main"; null for tags/other refs. */
function branchFromRef(ref: string | undefined): string | null {
  if (!ref?.startsWith("refs/heads/")) {
    return null;
  }
  const name = ref.slice("refs/heads/".length);
  return name.length ? name : null;
}

function pushedCommitsFrom(payload: PushPayload): PushedCommitInput[] {
  return (payload.commits ?? [])
    .filter((commit): commit is { id: string } & typeof commit => Boolean(commit.id))
    .map((commit) => ({
      sha: commit.id!,
      message: commit.message ?? "",
      committedAt: commit.timestamp ?? new Date().toISOString(),
      authorName: commit.author?.name ?? null,
      authorEmail: commit.author?.email ?? null,
      username: commit.author?.username ?? null
    }));
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
      const credential = repository.credentialId
        ? await prisma.gitCredential.findUnique({ where: { id: repository.credentialId } })
        : null;
      if (!credential) {
        return;
      }

      const token = decryptToken(credential.encryptedToken);
      const provider = getGitProvider(credential.provider);

      const branchName = branchFromRef(payload.ref);
      const pushed = pushedCommitsFrom(payload);
      if (branchName && pushed.length) {
        // Exact-sha ingest: immune to committer-date filtering, so commits
        // made earlier but pushed now are never missed.
        await ingestPushedCommits(repository, token, provider, branchName, pushed);
      } else {
        // No usable commit list (tag push, empty payload): re-list a recent
        // window ignoring the ledger.
        const now = new Date();
        await ingestRepository(
          repository,
          token,
          provider,
          new Date(now.getTime() - FALLBACK_WINDOW_MS),
          now,
          { forceRelist: true }
        );
      }

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
