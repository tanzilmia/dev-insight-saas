import { prisma } from "../../config/database.js";
import { ensureInitialAppBackfill } from "../activity/deep-collection.js";
import {
  enqueuePushIngestion,
  type PushPayload
} from "../activity/push-ingestion.service.js";

export type GitHubAppPushPayload = PushPayload & {
  installation?: { id?: number };
  repository?: { id?: number; full_name?: string };
};

/** Maps a verified App delivery to one active tenant repository, then queues it. */
export async function handleGitHubAppPushEvent(payload: GitHubAppPushPayload): Promise<void> {
  const installationId = payload.installation?.id;
  const repositoryExternalId = payload.repository?.id;
  if (installationId === undefined || repositoryExternalId === undefined) return;

  const installation = await prisma.gitHubAppInstallation.findFirst({
    where: { installationId: String(installationId), suspendedAt: null },
    select: { id: true, organizationId: true }
  });
  if (!installation) return;

  const repository = await prisma.repository.findFirst({
    where: {
      organizationId: installation.organizationId,
      provider: "GITHUB",
      externalId: String(repositoryExternalId),
      appInstallationId: installation.id,
      access: { some: { appInstallationId: installation.id } }
    },
    select: { id: true }
  });
  if (!repository) return;

  await ensureInitialAppBackfill(repository.id).catch((error) => {
    console.warn(`[github-app] initial backfill queue failed for repository ${repository.id}`, error);
  });
  enqueuePushIngestion(repository.id, payload);
}
