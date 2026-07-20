import type { Repository } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { getDevOpsProvider } from "../devops-providers/devops-provider-registry.js";
import type { WorkflowRunDto } from "../devops-providers/devops-provider.js";
import { handleCompletedWorkflowRun } from "../ci/ci-retry.service.js";
import { resolveRepositoryToken } from "./repository-token.js";

export type GitHubWorkflowRunPayload = {
  action?: string;
  installation?: { id?: number };
  repository?: { id?: number };
  workflow_run?: {
    id?: number;
    workflow_id?: number;
    name?: string | null;
    head_branch?: string | null;
    head_sha?: string | null;
    event?: string | null;
    status?: string | null;
    conclusion?: string | null;
    html_url?: string | null;
    run_started_at?: string | null;
    updated_at?: string | null;
  };
};

function toRun(payload: GitHubWorkflowRunPayload): WorkflowRunDto | null {
  const source = payload.workflow_run;
  if (source?.id === undefined) return null;
  return {
    runId: String(source.id),
    workflowId: source.workflow_id === undefined ? null : String(source.workflow_id),
    name: source.name ?? null,
    branch: source.head_branch ?? null,
    headSha: source.head_sha ?? null,
    event: source.event ?? null,
    status: source.status ?? null,
    conclusion: source.conclusion ?? null,
    actor: null,
    url: source.html_url ?? null,
    startedAt: source.run_started_at ?? null,
    completedAt: source.status === "completed" ? (source.updated_at ?? null) : null
  };
}

async function findRepository(payload: GitHubWorkflowRunPayload): Promise<Repository | null> {
  const installationId = payload.installation?.id;
  const repositoryExternalId = payload.repository?.id;
  if (installationId === undefined || repositoryExternalId === undefined) return null;

  const installation = await prisma.gitHubAppInstallation.findFirst({
    where: { installationId: String(installationId), suspendedAt: null },
    select: { id: true, organizationId: true }
  });
  if (!installation) return null;

  return prisma.repository.findFirst({
    where: {
      organizationId: installation.organizationId,
      provider: "GITHUB",
      externalId: String(repositoryExternalId),
      appInstallationId: installation.id,
      access: { some: { appInstallationId: installation.id } }
    }
  });
}

/** Handles a signed GitHub App workflow_run completion event. */
export async function handleGitHubAppWorkflowRunEvent(
  payload: GitHubWorkflowRunPayload
): Promise<void> {
  if (payload.action !== "completed" || !env.CI_AUTO_RETRY_ENABLED) return;
  const repository = await findRepository(payload);
  const run = toRun(payload);
  if (!repository || !run) return;

  const config = await prisma.ciConfiguration.findUnique({ where: { repositoryId: repository.id } });
  if (config?.status !== "ENABLED") return;

  const { token } = await resolveRepositoryToken(repository);
  const devops = getDevOpsProvider(repository.provider);
  await handleCompletedWorkflowRun(repository, token, devops, run);
}
