import type { CiConfiguration, Repository, WorkflowRun } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { resolveRepositoryToken } from "../github-app/repository-token.js";
import { getDevOpsProvider } from "../devops-providers/devops-provider-registry.js";
import type { DevOpsProvider, RepositoryRef } from "../devops-providers/devops-provider.js";
import { detectStack, type DetectedStack } from "./stack-detector.js";
import {
  MANAGED_WORKFLOW_PATH,
  generateWorkflow,
  parseManagedMarker
} from "./workflow-templates.js";

/**
 * GitHub Actions management: inspect a repository, install a managed workflow via
 * a pull request (never a direct push to the default branch), and track/sync its
 * status and run history. Authenticates ONLY through the GitHub App (installation
 * token resolved per call). Every mutation is
 * manager-gated and audit-logged. Built as the permanent DevOps layer: future
 * workflow updates (SonarQube, security scanning) reuse the same install flow.
 */

const SETUP_BRANCH = "devinside/ci-setup";

async function loadRepository(repositoryId: string): Promise<Repository> {
  const repository = await prisma.repository.findUnique({ where: { id: repositoryId } });
  if (!repository) {
    throw new AppError(404, "Repository was not found", "REPOSITORY_NOT_FOUND");
  }
  return repository;
}

function refOf(repository: Repository): RepositoryRef {
  return { owner: repository.owner, repo: repository.name };
}

/**
 * The Sonar project key to bake into the workflow's code-quality job — only when
 * the repo is actually provisioned (analysis token injected as a repo secret). A
 * key that is merely mapped (for reading results) must NOT emit the scan job, or
 * the scan would fail for lack of a token.
 */
function sonarKeyIfProvisioned(repository: Repository): string | null {
  return repository.sonarProvisionedAt ? repository.sonarProjectKey : null;
}

/** Resolves an installation token + the DevOps provider for a repository. */
async function accessFor(repository: Repository): Promise<{ token: string; devops: DevOpsProvider }> {
  const { token } = await resolveRepositoryToken(repository);
  return { token, devops: getDevOpsProvider(repository.provider) };
}

// --- Repository inspection ---------------------------------------------------

async function inspect(
  repository: Repository,
  token: string,
  devops: DevOpsProvider
): Promise<DetectedStack> {
  const ref = refOf(repository);
  const defaultBranch = await devops.getDefaultBranch(token, ref);
  const read = async (path: string) => (await devops.getFile(token, ref, path, defaultBranch))?.content ?? null;

  const [packageJson, packageLock, pnpmLock, yarnLock, nvmrc] = await Promise.all([
    read("package.json"),
    read("package-lock.json"),
    read("pnpm-lock.yaml"),
    read("yarn.lock"),
    read(".nvmrc")
  ]);

  return detectStack({
    defaultBranch,
    files: { packageJson, packageLock, pnpmLock, yarnLock, nvmrc }
  });
}

export async function inspectRepository(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const { token, devops } = await accessFor(repository);
  return inspect(repository, token, devops);
}

// --- Enable CI (idempotent, PR-based) ---------------------------------------

export async function enableCi(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const { token, devops } = await accessFor(repository);
  const ref = refOf(repository);
  const defaultBranch = await devops.getDefaultBranch(token, ref);

  // Inspect + generate (throws STACK_UNSUPPORTED for non-Node repos). The
  // workflow includes a SonarQube code-quality job only when the repo has been
  // provisioned for automated scanning (project created + analysis token injected
  // as a repo secret) — a mapped key alone is not enough, or the scan would fail
  // for lack of a token.
  const stack = await inspect(repository, token, devops);
  const workflow = generateWorkflow(stack, { sonarProjectKey: sonarKeyIfProvisioned(repository) });

  // Idempotency: the managed workflow already lives on the default branch. If its
  // content already matches what we'd generate, CI is up to date — record ENABLED
  // and skip the PR. If it DIFFERS (e.g. we now add a Sonar job), fall through to
  // open an update PR rather than treating it as done.
  const onDefault = await devops.getFile(token, ref, MANAGED_WORKFLOW_PATH, defaultBranch);
  if (onDefault && onDefault.content === workflow.content) {
    const marker = parseManagedMarker(onDefault.content);
    const config = await upsertConfig(repository, actorId, {
      status: "ENABLED",
      templateId: marker?.templateId ?? "node",
      templateVersion: marker?.templateVersion ?? "1",
      workflowPath: MANAGED_WORKFLOW_PATH,
      workflowFileSha: onDefault.sha,
      pullRequestState: "merged",
      lastSyncedAt: new Date()
    });
    await audit(repository, actorId, "ci.enable", { result: "already-on-default-branch" });
    return statusFor(repository, config, await latestRun(repositoryId), defaultBranch);
  }

  // Create/reuse the setup branch off the default branch head.
  const headSha = await devops.getBranchHeadSha(token, ref, defaultBranch);
  if (!headSha) {
    throw new AppError(400, "The repository's default branch has no commits yet.", "EMPTY_REPOSITORY");
  }
  await devops.createBranch(token, ref, SETUP_BRANCH, headSha);

  // Commit the workflow (update in place if a previous attempt left one).
  const existing = await devops.getFile(token, ref, workflow.path, SETUP_BRANCH);
  await devops.putFile(token, ref, {
    path: workflow.path,
    content: workflow.content,
    message: "ci: add DevInside-managed GitHub Actions workflow",
    branch: SETUP_BRANCH,
    sha: existing?.sha
  });

  // Idempotency 2: reuse an already-open setup PR instead of opening a duplicate.
  let pr = await devops.findOpenPullRequestByHead(token, ref, SETUP_BRANCH);
  if (!pr) {
    pr = await devops.createPullRequest(token, ref, {
      head: SETUP_BRANCH,
      base: defaultBranch,
      title: "Enable CI with DevInside",
      body: pullRequestBody(stack, sonarKeyIfProvisioned(repository))
    });
  }

  const config = await upsertConfig(repository, actorId, {
    status: "PENDING",
    templateId: workflow.templateId,
    templateVersion: workflow.templateVersion,
    workflowPath: workflow.path,
    setupBranch: SETUP_BRANCH,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.url,
    pullRequestState: pr.state,
    lastSyncedAt: new Date()
  });
  await audit(repository, actorId, "ci.enable", {
    pullRequestNumber: pr.number,
    templateVersion: workflow.templateVersion
  });

  return statusFor(repository, config, await latestRun(repositoryId), defaultBranch);
}

function pullRequestBody(stack: DetectedStack, sonarProjectKey?: string | null): string {
  const steps = ["install dependencies"]
    .concat(stack.scripts.prismaGenerate ? ["generate Prisma client"] : [])
    .concat(stack.scripts.lint ? ["lint"] : [])
    .concat(stack.scripts.typecheck ? ["typecheck"] : [])
    .concat(stack.scripts.test ? ["test"] : [])
    .concat(stack.scripts.build ? ["build"] : []);
  const sonar = sonarProjectKey?.trim() || null;
  return [
    "This pull request adds a GitHub Actions workflow managed by **DevInside**.",
    "",
    `Detected stack: **Node.js** (${stack.packageManager}${stack.isMonorepo ? ", monorepo" : ""}${stack.framework ? `, ${stack.framework}` : ""}), Node ${stack.nodeVersion}.`,
    "",
    `On every pull request and push to \`${stack.defaultBranch}\`, CI will run: ${steps.join(" → ")}.`,
    ...(sonar
      ? [
          "",
          `On each push to \`${stack.defaultBranch}\`, a **SonarQube code-quality scan** also runs (project \`${sonar}\`), waits for the Quality Gate, and sends results to your DevInside code-quality dashboard.${stack.scripts.testCoverage ? " It generates test coverage before scanning." : ""} It uses the \`SONAR_TOKEN\` / \`SONAR_HOST_URL\` repository secrets DevInside has set for you.`
        ]
      : []),
    "",
    "Merge this PR to enable GitHub Actions. DevInside will keep this workflow up to date (e.g. adding code-quality or security checks) via future pull requests — please don't edit the file by hand.",
    "",
    `_Least privilege: the workflow requests read-only permissions${sonar ? " and uses only the SonarQube analysis secrets" : " and uses no secrets"}._`
  ].join("\n");
}

// --- Disable / Sync / Status -------------------------------------------------

export async function disableCi(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const config = await upsertConfig(repository, actorId, { status: "DISABLED" });
  await audit(repository, actorId, "ci.disable", {});
  return statusFor(repository, config, await latestRun(repositoryId), repository.defaultBranch);
}

export async function syncCi(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const { token, devops } = await accessFor(repository);
  const ref = refOf(repository);
  const defaultBranch = await devops.getDefaultBranch(token, ref);

  const existing = await prisma.ciConfiguration.findUnique({ where: { repositoryId } });
  const update: Record<string, unknown> = { lastSyncedAt: new Date() };

  // Refresh the setup PR state, and detect a merged/enabled workflow.
  if (existing?.pullRequestNumber) {
    const pr = await devops.getPullRequest(token, ref, existing.pullRequestNumber);
    if (pr) {
      update.pullRequestState = pr.merged ? "merged" : pr.state;
    }
  }
  const onDefault = await devops.getFile(token, ref, MANAGED_WORKFLOW_PATH, defaultBranch);
  if (onDefault && existing?.status !== "DISABLED") {
    update.status = "ENABLED";
    update.workflowFileSha = onDefault.sha;
    update.workflowPath = MANAGED_WORKFLOW_PATH;
  }

  const config = existing
    ? await prisma.ciConfiguration.update({ where: { repositoryId }, data: update })
    : null;

  // Sync workflow runs (read-only mirror).
  await syncWorkflowRuns(repository, token, devops);

  await audit(repository, actorId, "ci.sync", {});
  return statusFor(repository, config, await latestRun(repositoryId), defaultBranch);
}

async function syncWorkflowRuns(
  repository: Repository,
  token: string,
  devops: DevOpsProvider
): Promise<void> {
  const runs = await devops.listWorkflowRuns(token, refOf(repository), { perPage: 20 });
  for (const run of runs) {
    const startedAt = run.startedAt ? new Date(run.startedAt) : null;
    const completedAt = run.completedAt ? new Date(run.completedAt) : null;
    const durationMs =
      startedAt && completedAt ? completedAt.getTime() - startedAt.getTime() : null;
    const data = {
      organizationId: repository.organizationId,
      workflowId: run.workflowId,
      name: run.name,
      branch: run.branch,
      headSha: run.headSha,
      event: run.event,
      status: run.status,
      conclusion: run.conclusion,
      actor: run.actor,
      url: run.url,
      startedAt,
      completedAt,
      durationMs
    };
    await prisma.workflowRun.upsert({
      where: { repositoryId_runId: { repositoryId: repository.id, runId: run.runId } },
      create: { repositoryId: repository.id, runId: run.runId, ...data },
      update: data
    });
  }
}

/**
 * Merges the setup pull request from DevInside (an explicit manager action — not
 * silent auto-merge). Uses the App's Pull requests write permission; after a
 * successful merge the managed workflow lands on the default branch and CI is
 * ENABLED. Not-mergeable PRs (conflicts/required checks) surface a clear error
 * telling the user to merge on GitHub instead.
 */
export async function mergeCi(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationRole(actorId, repository.organizationId, MANAGER_ROLES);

  const config = await prisma.ciConfiguration.findUnique({ where: { repositoryId } });
  if (!config?.pullRequestNumber) {
    throw new AppError(400, "There is no setup pull request to merge. Enable CI first.", "NO_SETUP_PR");
  }

  const { token, devops } = await accessFor(repository);
  const ref = refOf(repository);
  const result = await devops.mergePullRequest(token, ref, config.pullRequestNumber);

  const updated = await prisma.ciConfiguration.update({
    where: { repositoryId },
    data: {
      status: "ENABLED",
      pullRequestState: "merged",
      workflowPath: MANAGED_WORKFLOW_PATH,
      lastSyncedAt: new Date()
    }
  });
  await audit(repository, actorId, "ci.merge", {
    pullRequestNumber: config.pullRequestNumber,
    merged: result.merged
  });

  // Best-effort: the push-triggered run may take a moment to appear.
  await syncWorkflowRuns(repository, token, devops).catch(() => {});
  const defaultBranch = await devops
    .getDefaultBranch(token, ref)
    .catch(() => repository.defaultBranch);

  return statusFor(repository, updated, await latestRun(repositoryId), defaultBranch);
}

export async function getCiStatus(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationMember(actorId, repository.organizationId);

  const config = await prisma.ciConfiguration.findUnique({ where: { repositoryId } });
  return statusFor(repository, config, await latestRun(repositoryId), repository.defaultBranch);
}

export async function listWorkflowRuns(actorId: string, repositoryId: string) {
  const repository = await loadRepository(repositoryId);
  await requireOrganizationMember(actorId, repository.organizationId);

  const runs = await prisma.workflowRun.findMany({
    where: { repositoryId },
    orderBy: { startedAt: "desc" },
    take: 20
  });
  return runs.map(toRun);
}

// --- Persistence + DTO helpers ----------------------------------------------

async function upsertConfig(
  repository: Repository,
  actorId: string,
  data: Record<string, unknown>
): Promise<CiConfiguration> {
  return prisma.ciConfiguration.upsert({
    where: { repositoryId: repository.id },
    create: {
      organizationId: repository.organizationId,
      repositoryId: repository.id,
      enabledById: actorId,
      ...data
    },
    update: data
  });
}

async function latestRun(repositoryId: string): Promise<WorkflowRun | null> {
  return prisma.workflowRun.findFirst({
    where: { repositoryId },
    orderBy: { startedAt: "desc" }
  });
}

async function audit(
  repository: Repository,
  actorId: string,
  action: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: repository.organizationId,
      actorId,
      action,
      entityType: "CiConfiguration",
      entityId: repository.id,
      metadataJson: { fullName: repository.fullName, ...metadata }
    }
  });
}

function toRun(run: WorkflowRun) {
  return {
    runId: run.runId,
    name: run.name,
    branch: run.branch,
    headSha: run.headSha,
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    actor: run.actor,
    url: run.url,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs
  };
}

function statusFor(
  repository: Repository,
  config: CiConfiguration | null,
  latest: WorkflowRun | null,
  defaultBranch: string | null
) {
  const base = repository.remoteUrl.replace(/\/$/, "");
  const enabled = config?.status === "ENABLED";
  return {
    repositoryId: repository.id,
    fullName: repository.fullName,
    defaultBranch: defaultBranch ?? repository.defaultBranch,
    status: config?.status ?? "NOT_CONFIGURED",
    enabled,
    templateId: config?.templateId ?? null,
    templateVersion: config?.templateVersion ?? null,
    workflowPath: config?.workflowPath ?? null,
    workflowUrl:
      enabled && config?.workflowPath
        ? `${base}/blob/${defaultBranch ?? repository.defaultBranch ?? "main"}/${config.workflowPath}`
        : null,
    actionsUrl: `${base}/actions`,
    pullRequest: config?.pullRequestNumber
      ? {
          number: config.pullRequestNumber,
          url: config.pullRequestUrl,
          state: config.pullRequestState
        }
      : null,
    lastSyncedAt: config?.lastSyncedAt ?? null,
    latestRun: latest ? toRun(latest) : null
  };
}
