import { prisma } from "../../config/database.js";
import { resolveRepositoryToken } from "../github-app/repository-token.js";
import { discoverContributorsForRepository } from "../contributors/contributors.service.js";
import {
  ingestPushedCommits,
  ingestRepository,
  type PushedCommitInput
} from "./activity.service.js";

const FALLBACK_WINDOW_MS = 48 * 60 * 60 * 1000;

export type PushPayload = {
  ref?: string;
  commits?: {
    id?: string;
    message?: string;
    timestamp?: string;
    author?: { name?: string; email?: string; username?: string };
  }[];
  head_commit?: { timestamp?: string } | null;
};

/** One FIFO per repository: every verified delivery is processed in order. */
const queues = new Map<string, PushPayload[]>();
const draining = new Set<string>();

function branchFromRef(ref: string | undefined): string | null {
  if (!ref?.startsWith("refs/heads/")) return null;
  const name = ref.slice("refs/heads/".length);
  return name.length ? name : null;
}

function pushedCommitsFrom(payload: PushPayload): PushedCommitInput[] {
  return (payload.commits ?? [])
    .filter((commit): commit is { id: string } & typeof commit => Boolean(commit.id))
    .map((commit) => ({
      sha: commit.id,
      message: commit.message ?? "",
      committedAt: commit.timestamp ?? new Date().toISOString(),
      authorName: commit.author?.name ?? null,
      authorEmail: commit.author?.email ?? null,
      username: commit.author?.username ?? null
    }));
}

async function ingestOne(repositoryId: string, payload: PushPayload): Promise<void> {
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) return;

  const { token, provider } = await resolveRepositoryToken(repository);
  const branchName = branchFromRef(payload.ref);
  const pushed = pushedCommitsFrom(payload);

  if (branchName && pushed.length) {
    await ingestPushedCommits(repository, token, provider, branchName, pushed);
  } else {
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

  const pushedUsernames = [
    ...new Set(pushed.map((commit) => commit.username).filter((value): value is string => Boolean(value)))
  ];
  if (pushedUsernames.length) {
    const knownCount = await prisma.contributorIdentity.count({
      where: { repositoryId, username: { in: pushedUsernames } }
    });
    if (knownCount < pushedUsernames.length) {
      await discoverContributorsForRepository(repository, null);
    }
  }

  await prisma.repository.update({
    where: { id: repositoryId },
    data: { lastWebhookAt: new Date(), webhookStatus: "ACTIVE" }
  });
}

async function drain(repositoryId: string): Promise<void> {
  if (draining.has(repositoryId)) return;
  draining.add(repositoryId);

  try {
    const queue = queues.get(repositoryId);
    while (queue?.length) {
      const payload = queue.shift()!;
      try {
        await ingestOne(repositoryId, payload);
      } catch (error) {
        console.warn(`[github-app] push ingest failed for repository ${repositoryId}`, error);
        await prisma.repository
          .update({ where: { id: repositoryId }, data: { webhookStatus: "ERROR" } })
          .catch(() => {});
      }
    }
  } finally {
    queues.delete(repositoryId);
    draining.delete(repositoryId);
  }
}

/** Queues a verified GitHub App push and returns immediately. */
export function enqueuePushIngestion(repositoryId: string, payload: PushPayload): void {
  const queue = queues.get(repositoryId) ?? [];
  queue.push(payload);
  queues.set(repositoryId, queue);
  void drain(repositoryId);
}
