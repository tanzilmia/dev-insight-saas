import axios from "axios";

import { getStoredToken } from "./auth-storage";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json"
  }
});

// Attach the stored access token to every request when one is present.
api.interceptors.request.use((config) => {
  const token = getStoredToken();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  status: string;
  createdAt: string;
};

export type AuthOrganization = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export type AuthResponse = {
  accessToken: string;
  user: AuthUser;
  organization?: AuthOrganization;
  organizations?: AuthOrganization[];
};

export async function registerAccount(input: {
  name: string;
  email: string;
  password: string;
  organizationName: string;
}) {
  const response = await api.post<AuthResponse>("/api/auth/register", input);
  return response.data;
}

export async function loginAccount(input: { email: string; password: string }) {
  const response = await api.post<AuthResponse>("/api/auth/login", input);
  return response.data;
}

export async function getCurrentUser(accessToken: string) {
  const response = await api.get<{
    user: AuthUser;
    organizations: AuthOrganization[];
  }>("/api/auth/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  return response.data;
}

/* ------------------------------------------------------------------ */
/* Employees                                                          */
/* ------------------------------------------------------------------ */

export type OrgRole = "OWNER" | "MANAGER" | "EMPLOYEE" | "ADMIN";
export type AssignableRole = "EMPLOYEE" | "MANAGER" | "ADMIN";
export type MemberStatus = "ACTIVE" | "DISABLED";

export type EmployeeGitAlias = {
  id: string;
  username: string | null;
  email: string | null;
  name: string | null;
  isPrimary: boolean;
};

export type Employee = {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  joinedAt: string;
  gitAliases: EmployeeGitAlias[];
};

export async function listEmployees(organizationId: string) {
  const response = await api.get<{ employees: Employee[] }>("/api/employees", {
    params: { organizationId }
  });

  return response.data.employees;
}

export async function createEmployee(input: {
  organizationId: string;
  name: string;
  email: string;
  role: AssignableRole;
  gitUsernames?: string[];
}) {
  const response = await api.post<{ employee: Employee }>("/api/employees", input);
  return response.data.employee;
}

export type BulkEmployeeRow = {
  name: string;
  email: string;
  role?: AssignableRole;
  gitUsernames?: string[];
};

export type BulkEmployeeResult = {
  email: string;
  status: "created" | "skipped" | "failed";
  message?: string;
};

export type BulkImportSummary = {
  created: number;
  total: number;
  results: BulkEmployeeResult[];
};

/** Bulk-add employees parsed from a CSV; each row succeeds/fails independently. */
export async function bulkCreateEmployees(input: {
  organizationId: string;
  employees: BulkEmployeeRow[];
}) {
  const response = await api.post<{ result: BulkImportSummary }>("/api/employees/bulk", input);
  return response.data.result;
}

export async function addEmployeeGitAlias(
  userId: string,
  input: { organizationId: string; username: string; isPrimary?: boolean }
) {
  const response = await api.post<{ employee: Employee }>(
    `/api/employees/${userId}/git-aliases`,
    input
  );

  return response.data.employee;
}

export async function removeEmployeeGitAlias(
  userId: string,
  aliasId: string,
  organizationId: string
) {
  const response = await api.delete<{ employee: Employee }>(
    `/api/employees/${userId}/git-aliases/${aliasId}`,
    { params: { organizationId } }
  );

  return response.data.employee;
}

export async function updateEmployee(
  userId: string,
  input: {
    organizationId: string;
    name?: string;
    role?: AssignableRole;
    status?: MemberStatus;
  }
) {
  const response = await api.patch<{ employee: Employee }>(
    `/api/employees/${userId}`,
    input
  );

  return response.data.employee;
}

/* ------------------------------------------------------------------ */
/* Projects                                                           */
/* ------------------------------------------------------------------ */

export type ProjectStatus = "ACTIVE" | "ARCHIVED";
export type ProjectRole = "LEAD" | "DEVELOPER" | "REVIEWER";

export type Project = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectMember = {
  id: string;
  name: string;
  email: string;
  role: ProjectRole;
  addedAt: string;
};

export type ProjectDetail = Project & { members: ProjectMember[] };

export async function listProjects(organizationId: string, status?: ProjectStatus) {
  const response = await api.get<{ projects: Project[] }>("/api/projects", {
    params: { organizationId, ...(status ? { status } : {}) }
  });

  return response.data.projects;
}

export async function createProject(input: {
  organizationId: string;
  name: string;
  description?: string;
  members?: { userId: string; role: ProjectRole }[];
}) {
  const response = await api.post<{ project: Project }>("/api/projects", input);
  return response.data.project;
}

export async function getProject(projectId: string) {
  const response = await api.get<{ project: ProjectDetail }>(
    `/api/projects/${projectId}`
  );

  return response.data.project;
}

export async function updateProject(
  projectId: string,
  input: { name?: string; description?: string | null; status?: ProjectStatus }
) {
  const response = await api.patch<{ project: Project }>(
    `/api/projects/${projectId}`,
    input
  );

  return response.data.project;
}

export async function deleteProject(projectId: string) {
  const response = await api.delete<{ id: string }>(`/api/projects/${projectId}`);
  return response.data;
}

export async function addProjectMember(
  projectId: string,
  input: { userId: string; role: ProjectRole }
) {
  const response = await api.post<{ member: ProjectMember }>(
    `/api/projects/${projectId}/members`,
    input
  );

  return response.data.member;
}

export async function removeProjectMember(projectId: string, userId: string) {
  const response = await api.delete<{ projectId: string; userId: string }>(
    `/api/projects/${projectId}/members/${userId}`
  );

  return response.data;
}

/* ------------------------------------------------------------------ */
/* Git credentials                                                    */
/* ------------------------------------------------------------------ */

export type CredentialStatus = "CONNECTED" | "INVALID" | "DISCONNECTED";

export type GitCredential = {
  id: string;
  provider: "GITHUB";
  status: CredentialStatus;
  tokenLast4: string | null;
  accountLogin: string | null;
  scopes: string[];
  /** Which repo affiliations "Sync from GitHub" lists (owner/collaborator/organization_member). */
  repoAffiliations: string[];
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listCredentials(organizationId: string) {
  const response = await api.get<{ credentials: GitCredential[] }>(
    "/api/git-credentials",
    { params: { organizationId } }
  );

  return response.data.credentials;
}

export async function connectCredential(input: {
  organizationId: string;
  token: string;
}) {
  const response = await api.post<{ credential: GitCredential }>(
    "/api/git-credentials",
    input
  );

  return response.data.credential;
}

/** A GitHub account resolved from a handle, for previewing before mapping. */
export type GitUserProfile = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
  company: string | null;
  location: string | null;
  bio: string | null;
  type: string;
};

/** Resolves a GitHub username via the org credential; null if it doesn't exist. */
export async function resolveGitUser(organizationId: string, username: string) {
  const response = await api.get<{ user: GitUserProfile | null }>(
    "/api/git-credentials/resolve-user",
    { params: { organizationId, username } }
  );

  return response.data.user;
}

export async function validateCredential(credentialId: string) {
  const response = await api.post<{ credential: GitCredential }>(
    `/api/git-credentials/${credentialId}/validate`
  );

  return response.data.credential;
}

export async function reconnectCredential(credentialId: string, token: string) {
  const response = await api.patch<{ credential: GitCredential }>(
    `/api/git-credentials/${credentialId}/reconnect`,
    { token }
  );

  return response.data.credential;
}

export async function updateCredentialRepoAccess(
  credentialId: string,
  repoAffiliations: string[]
) {
  const response = await api.patch<{ credential: GitCredential }>(
    `/api/git-credentials/${credentialId}/repo-access`,
    { repoAffiliations }
  );

  return response.data.credential;
}

export async function deleteCredential(credentialId: string) {
  const response = await api.delete<{ id: string }>(
    `/api/git-credentials/${credentialId}`
  );

  return response.data;
}

/* -------------------------- GitHub App connection -------------------------- */

export type GitHubAppInstallation = {
  id: string;
  installationId: string;
  accountLogin: string;
  accountType: string | null;
  targetType: string | null;
  repositorySelection: string | null;
  repositoryCount: number;
  suspended: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
};

export type GitHubAppStatus = {
  /** Whether the DevInside owner has registered the App on this server. */
  configured: boolean;
  connected: boolean;
  installations: GitHubAppInstallation[];
};

export async function getGitHubAppStatus(organizationId: string) {
  const response = await api.get<GitHubAppStatus>("/api/github-app/status", {
    params: { organizationId }
  });
  return response.data;
}

export async function getGitHubAppInstallUrl(organizationId: string) {
  const response = await api.get<{ url: string }>("/api/github-app/install-url", {
    params: { organizationId }
  });
  return response.data.url;
}

export async function linkGitHubAppInstallation(input: {
  organizationId: string;
  installationId: string;
  setupAction?: string;
}) {
  const response = await api.post<GitHubAppStatus>(
    "/api/github-app/installations/callback",
    input
  );
  return response.data;
}

export async function syncGitHubAppInstallation(
  organizationId: string,
  appInstallationId: string
) {
  const response = await api.post<GitHubAppStatus>(
    `/api/github-app/installations/${appInstallationId}/sync`,
    { organizationId }
  );
  return response.data;
}

export async function disconnectGitHubApp(organizationId: string, appInstallationId: string) {
  const response = await api.delete<GitHubAppStatus>(
    `/api/github-app/installations/${appInstallationId}`,
    { params: { organizationId } }
  );
  return response.data;
}

/* --------------------- CI / GitHub Actions management ---------------------- */

export type CiWorkflowRun = {
  runId: string;
  name: string | null;
  branch: string | null;
  headSha: string | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  actor: string | null;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

export type CiStatus = {
  repositoryId: string;
  fullName: string;
  defaultBranch: string | null;
  status: "NOT_CONFIGURED" | "PENDING" | "ENABLED" | "DISABLED" | string;
  enabled: boolean;
  templateId: string | null;
  templateVersion: string | null;
  workflowPath: string | null;
  workflowUrl: string | null;
  actionsUrl: string;
  pullRequest: { number: number; url: string | null; state: string | null } | null;
  lastSyncedAt: string | null;
  latestRun: CiWorkflowRun | null;
};

export type CiInspection = {
  supported: boolean;
  runtime: string;
  defaultBranch: string;
  packageManager: string;
  isMonorepo: boolean;
  framework: string | null;
  nodeVersion: string;
  scripts: { lint: boolean; typecheck: boolean; test: boolean; build: boolean };
  reason: string | null;
};

export async function getCiStatus(repositoryId: string) {
  const response = await api.get<CiStatus>("/api/ci/status", { params: { repositoryId } });
  return response.data;
}

export async function inspectRepositoryCi(repositoryId: string) {
  const response = await api.get<CiInspection>("/api/ci/inspect", { params: { repositoryId } });
  return response.data;
}

export async function listCiRuns(repositoryId: string) {
  const response = await api.get<{ runs: CiWorkflowRun[] }>("/api/ci/runs", {
    params: { repositoryId }
  });
  return response.data.runs;
}

export async function enableCi(repositoryId: string) {
  const response = await api.post<CiStatus>("/api/ci/enable", { repositoryId });
  return response.data;
}

export async function disableCi(repositoryId: string) {
  const response = await api.post<CiStatus>("/api/ci/disable", { repositoryId });
  return response.data;
}

export async function syncCi(repositoryId: string) {
  const response = await api.post<CiStatus>("/api/ci/sync", { repositoryId });
  return response.data;
}

export async function mergeCi(repositoryId: string) {
  const response = await api.post<CiStatus>("/api/ci/merge", { repositoryId });
  return response.data;
}

/* ------------------------------------------------------------------ */
/* Repositories                                                       */
/* ------------------------------------------------------------------ */

export type RepositoryInput = {
  externalId: string;
  owner: string;
  name: string;
  fullName: string;
  remoteUrl: string;
  isPrivate: boolean;
  defaultBranch: string | null;
};

/** A repository available on the provider, with tracking status. */
export type AvailableRepository = RepositoryInput & { tracked: boolean };

/** A repository persisted (tracked) for the organization. */
export type TrackedRepository = RepositoryInput & {
  id: string;
  provider: "GITHUB";
  project: { id: string; name: string } | null;
  /** SonarQube/SonarCloud project key this repo is analyzed under (null = unset). */
  sonarProjectKey: string | null;
  commitCount: number;
  lastSyncedAt: string | null;
  /** Live sync (GitHub webhook) state. null status = off. */
  liveSync: { status: "ACTIVE" | "ERROR" | null; lastWebhookAt: string | null };
  createdAt: string;
  updatedAt: string;
};

export async function enableLiveSync(repositoryId: string) {
  const response = await api.post<{ repository: TrackedRepository }>(
    `/api/repositories/${repositoryId}/live-sync`
  );

  return response.data.repository;
}

export async function disableLiveSync(repositoryId: string) {
  const response = await api.delete<{ repository: TrackedRepository }>(
    `/api/repositories/${repositoryId}/live-sync`
  );

  return response.data.repository;
}

export type CollectActivityResult = {
  range: { since: string; until: string };
  newCollected: number;
  branchesChecked: number;
  branchesCollected: number;
  rangesCollected: number;
  /** True when a per-run cap truncated the window — click Collect again or use Deep collect. */
  capped: boolean;
};

export async function collectActivity(repositoryId: string) {
  const response = await api.post<{ activity: CollectActivityResult }>(
    `/api/repositories/${repositoryId}/activity`,
    {}
  );

  return response.data.activity;
}

export type CollectionJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

/** A background deep-history collection job (latest one per repository). */
export type CollectionJob = {
  id: string;
  repositoryId: string;
  status: CollectionJobStatus;
  rangeStart: string;
  rangeEnd: string;
  branchesTotal: number;
  branchesDone: number;
  chunksTotal: number;
  chunksDone: number;
  commitsCollected: number;
  currentBranch: string | null;
  currentPhase: string | null;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export async function startDeepCollection(
  repositoryId: string,
  lookbackDays: number,
  verify = false
) {
  const response = await api.post<{ job: CollectionJob }>(
    `/api/repositories/${repositoryId}/deep-collect`,
    { lookbackDays, verify }
  );

  return response.data.job;
}

export async function listCollectionJobs(organizationId: string) {
  const response = await api.get<{ jobs: CollectionJob[] }>(
    "/api/repositories/collection-jobs",
    { params: { organizationId } }
  );

  return response.data.jobs;
}

export async function cancelDeepCollection(repositoryId: string) {
  const response = await api.post<{ job: CollectionJob }>(
    `/api/repositories/${repositoryId}/deep-collect/cancel`
  );

  return response.data.job;
}

export async function listRepositories(organizationId: string) {
  const response = await api.get<{ repositories: TrackedRepository[] }>(
    "/api/repositories",
    { params: { organizationId } }
  );

  return response.data.repositories;
}

export async function syncRepositories(organizationId: string) {
  const response = await api.post<{ repositories: AvailableRepository[] }>(
    "/api/repositories/sync",
    { organizationId }
  );

  return response.data.repositories;
}

export async function selectRepositories(
  organizationId: string,
  repositories: RepositoryInput[]
) {
  const response = await api.post<{ repositories: TrackedRepository[] }>(
    "/api/repositories/select",
    { organizationId, repositories }
  );

  return response.data.repositories;
}

export async function assignRepositoryProject(
  repositoryId: string,
  projectId: string | null
) {
  const response = await api.patch<{ repository: TrackedRepository }>(
    `/api/repositories/${repositoryId}`,
    { projectId }
  );

  return response.data.repository;
}

export async function setRepositorySonarProjectKey(
  repositoryId: string,
  sonarProjectKey: string | null
) {
  const response = await api.patch<{ repository: TrackedRepository }>(
    `/api/repositories/${repositoryId}/sonar-project`,
    { sonarProjectKey }
  );

  return response.data.repository;
}

export async function resyncRepository(repositoryId: string) {
  const response = await api.post<{ repository: TrackedRepository }>(
    `/api/repositories/${repositoryId}/resync`
  );

  return response.data.repository;
}

export async function untrackRepository(repositoryId: string) {
  const response = await api.delete<{ id: string }>(
    `/api/repositories/${repositoryId}`
  );

  return response.data;
}

/* ------------------------------------------------------------------ */
/* Contributors                                                       */
/* ------------------------------------------------------------------ */

export type ContributorMapping = {
  userId: string;
  name: string;
  email: string;
  isPrimary: boolean;
};

export type Contributor = {
  id: string;
  externalId: string;
  username: string | null;
  avatarUrl: string | null;
  contributions: number;
  ignored: boolean;
  mapping: ContributorMapping | null;
};

export async function listRepositoryContributors(repositoryId: string) {
  const response = await api.get<{ contributors: Contributor[] }>(
    "/api/contributors",
    { params: { repositoryId } }
  );

  return response.data.contributors;
}

export type UnmappedContributorSample = {
  username: string | null;
  avatarUrl: string | null;
  contributions: number;
  repositoryCount: number;
};

export type UnmappedSummary = {
  count: number;
  sample: UnmappedContributorSample[];
};

/** Org-wide count of contributor identities not yet linked to an employee. */
export async function getUnmappedSummary(organizationId: string) {
  const response = await api.get<{ summary: UnmappedSummary }>(
    "/api/contributors/unmapped-summary",
    { params: { organizationId } }
  );

  return response.data.summary;
}

export type ContributorSuggestionMatch = {
  userId: string;
  name: string;
  confidence: "high" | "medium";
  reason: string;
  score: number;
};

export type ContributorSuggestion = {
  contributorId: string;
  suggestions: ContributorSuggestionMatch[];
};

/** Likely employee matches for still-unmapped contributors (manager-only). */
export async function listContributorSuggestions(repositoryId: string) {
  const response = await api.get<{ suggestions: ContributorSuggestion[] }>(
    "/api/contributors/suggestions",
    { params: { repositoryId } }
  );

  return response.data.suggestions;
}

export async function discoverContributors(repositoryId: string) {
  const response = await api.post<{ contributors: Contributor[] }>(
    "/api/contributors/discover",
    { repositoryId }
  );

  return response.data.contributors;
}

export async function mapContributor(
  contributorId: string,
  userId: string,
  isPrimary = false
) {
  const response = await api.post<{ contributor: Contributor }>(
    `/api/contributors/${contributorId}/map`,
    { userId, isPrimary }
  );

  return response.data.contributor;
}

export async function unmapContributor(contributorId: string) {
  const response = await api.delete<{ contributor: Contributor }>(
    `/api/contributors/${contributorId}/map`
  );

  return response.data.contributor;
}

export async function ignoreContributor(contributorId: string, ignored: boolean) {
  const response = await api.post<{ contributor: Contributor }>(
    `/api/contributors/${contributorId}/ignore`,
    { ignored }
  );

  return response.data.contributor;
}

/* ------------------------------------------------------------------ */
/* Reports (OpenClaw orchestration)                                   */
/* ------------------------------------------------------------------ */

export type ReportType = "repository" | "project" | "employee" | "team";
export type ReportPeriod =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_month"
  | "last_month"
  | "custom";
export type ReportStatus = "GENERATED" | "PARTIAL";

export type ReportStatistics = {
  commits: number;
  additions: number;
  deletions: number;
  filesChanged: number;
};

export type GenerateReportInput = {
  organizationId: string;
  reportType: ReportType;
  repositoryId?: string;
  projectId?: string;
  employeeIds?: string[];
  period: ReportPeriod;
  customRange?: { from: string; to: string };
  customPrompt?: string;
  /** Restrict the report to commits reachable from this branch. */
  branch?: string;
};

export type EmployeeLeaderboardRow = {
  rank: number;
  employeeId: string | null;
  name: string;
  usernames: string[];
  mapped: boolean;
  commits: number;
  additions: number;
  deletions: number;
  filesChanged: number;
  lines: number;
  sampleMessages: string[];
};

export type ReportMetricDelta = { current: number; previous: number; deltaPct: number | null };

export type ReportRankMovement = {
  name: string;
  employeeId: string | null;
  currentRank: number | null;
  previousRank: number | null;
  status: "up" | "down" | "same" | "new" | "dropped";
  delta: number | null;
};

export type ReportComparison = {
  previousPeriod: { from: string; to: string };
  hasBaseline: boolean;
  commits: ReportMetricDelta;
  additions: ReportMetricDelta;
  deletions: ReportMetricDelta;
  filesChanged: ReportMetricDelta;
  contributors: ReportMetricDelta;
  movers: ReportRankMovement[];
};

export type ReportInsight = { kind: string; severity: "info" | "warn"; text: string };

export type ReportTheme = {
  title: string;
  summary: string;
  size: "small" | "medium" | "large";
};

export type GeneratedReport = {
  reportId: string;
  reportType: ReportType;
  title: string;
  markdown: string;
  period: { from: string; to: string };
  project: { id: string; name: string } | null;
  repository: { id: string; fullName: string } | null;
  employees: {
    id: string;
    name: string;
    email: string;
    mappedIdentities: number;
  }[];
  statistics: ReportStatistics;
  leaderboard?: EmployeeLeaderboardRow[];
  comparison?: ReportComparison | null;
  insights?: ReportInsight[] | null;
  themes?: ReportTheme[] | null;
  status: ReportStatus;
  pending: string[];
  /** Non-fatal collection notes, e.g. a repo skipped for a missing credential. */
  warnings?: string[];
  /** True when this report was served from the cache (no LLM re-run). */
  cached?: boolean;
};

export type ReportSummary = {
  id: string;
  organizationId: string;
  reportType: ReportType;
  targetLabel: string;
  title: string;
  status: ReportStatus;
  generatedBy: "llm" | "template" | null;
  period: { from: string; to: string };
  statistics: ReportStatistics | null;
  createdAt: string;
};

export type ReportContributor = {
  id: string;
  userId: string | null;
  contributorIdentityId: string | null;
  name: string | null;
  commitCount: number;
};

export type ReportDetail = ReportSummary & {
  markdown: string;
  repositoryId: string | null;
  projectId: string | null;
  requestedById: string | null;
  shareToken: string | null;
  comparison?: ReportComparison | null;
  insights?: ReportInsight[] | null;
  themes?: ReportTheme[] | null;
  contributors: ReportContributor[];
};

export async function generateReport(input: GenerateReportInput) {
  const response = await api.post<{ report: GeneratedReport }>(
    "/api/openclaw/reports/generate",
    input
  );

  return response.data.report;
}

export async function listReports(organizationId: string, reportType?: ReportType) {
  const response = await api.get<{ reports: ReportSummary[] }>("/api/reports", {
    params: { organizationId, ...(reportType ? { reportType } : {}) }
  });

  return response.data.reports;
}

export async function getReport(reportId: string) {
  const response = await api.get<{ report: ReportDetail }>(`/api/reports/${reportId}`);
  return response.data.report;
}

export async function deleteReport(reportId: string) {
  await api.delete(`/api/reports/${reportId}`);
}

export async function shareReport(reportId: string) {
  const response = await api.post<{ token: string }>(`/api/reports/${reportId}/share`);
  return response.data.token;
}

export async function unshareReport(reportId: string) {
  await api.delete(`/api/reports/${reportId}/share`);
}

export type PublicReport = {
  title: string;
  markdown: string;
  reportType: ReportType;
  targetLabel: string;
  status: ReportStatus;
  period: { from: string; to: string };
  statistics: ReportStatistics | null;
  comparison?: ReportComparison | null;
  insights?: ReportInsight[] | null;
  themes?: ReportTheme[] | null;
  createdAt: string;
};

export async function getPublicReport(token: string) {
  const response = await api.get<{ report: PublicReport }>(`/api/public/reports/${token}`);
  return response.data.report;
}

/* ------------------------------------------------------------------ */
/* OpenClaw assistant (website chat)                                  */
/* ------------------------------------------------------------------ */

export async function getChatStatus() {
  const response = await api.get<{ configured: boolean }>("/api/openclaw/chat/status");
  return response.data.configured;
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Streams the assistant reply. Uses fetch (not axios) so the response body can
 * be read incrementally; `onDelta` fires for each text chunk. `messages` is the
 * recent conversation so the agent keeps context. Pass an `AbortSignal` to
 * cancel the request (Stop button / unmount). Returns the full reply once the
 * stream ends.
 */
export async function streamAssistantMessage(
  organizationId: string,
  messages: ChatTurn[],
  onDelta: (delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const token = getStoredToken();
  const response = await fetch(`${API_URL}/api/openclaw/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ organizationId, messages }),
    signal
  });

  if (!response.ok || !response.body) {
    let messageText = "Request failed";
    try {
      const data = await response.json();
      messageText = data?.error?.message ?? messageText;
    } catch {
      // Non-JSON error body — keep the default message.
    }
    throw new Error(messageText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  let streamError: string | null = null;

  // Each line is a JSON event: {type:"delta",text} or {type:"error",message}.
  // A "delta" appends to the reply; an "error" (mid-stream gateway failure) is
  // surfaced as a thrown error instead of being rendered as a normal reply.
  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    let event: { type?: string; text?: string; message?: string };
    try {
      event = JSON.parse(trimmed);
    } catch {
      return; // ignore a malformed / partial line
    }
    if (event.type === "delta" && event.text) {
      full += event.text;
      onDelta(event.text);
    } else if (event.type === "error") {
      streamError = event.message ?? "Failed to generate a reply";
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  }
  handleLine(buffer); // flush a trailing line that had no newline

  if (streamError) {
    throw new Error(streamError);
  }

  return full;
}

/* ------------------------------------------------------------------ */
/* Statistics (dashboard)                                             */
/* ------------------------------------------------------------------ */

export type StatPeriod =
  | "today"
  | "yesterday"
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_month"
  | "last_month";

export type StatisticsOverview = {
  period: { from: string; to: string };
  totals: {
    commits: number;
    additions: number;
    deletions: number;
    filesChanged: number;
    repositories: number;
    contributors: number;
  };
  commitsOverTime: { date: string; commits: number; additions: number; deletions: number }[];
  topContributors: EmployeeLeaderboardRow[];
  byRepository: { id: string; name: string; commits: number; additions: number; deletions: number }[];
  byProject: { id: string; name: string; commits: number }[];
  categories: Record<string, number>;
  topModules: { module: string; changes: number }[];
  risks: string[];
};

export async function getStatisticsOverview(
  organizationId: string,
  period: StatPeriod = "last_30_days"
) {
  const response = await api.get<{ overview: StatisticsOverview }>("/api/statistics/overview", {
    params: { organizationId, period }
  });

  return response.data.overview;
}

/* ------------------------------------------------------------------ */
/* Code quality (SonarQube measures + per-developer issues)           */
/* ------------------------------------------------------------------ */

export type QualityRating = "A" | "B" | "C" | "D" | "E" | null;

export type CodeQualityMeasures = {
  linesOfCode: number | null;
  bugs: number | null;
  vulnerabilities: number | null;
  securityHotspots: number | null;
  codeSmells: number | null;
  coverage: number | null;
  duplicatedLinesDensity: number | null;
  techDebtMinutes: number | null;
  reliabilityRating: QualityRating;
  securityRating: QualityRating;
  maintainabilityRating: QualityRating;
};

export type CodeQualityDeveloper = {
  author: string;
  total: number;
  bugs: number;
  vulnerabilities: number;
  codeSmells: number;
  bySeverity: Record<string, number>;
  /** Matched employee, or null when the git author isn't mapped to anyone. */
  employee: { userId: string; name: string; email: string } | null;
};

export type QualityGateStatus = {
  status: "OK" | "ERROR" | "WARN" | "NONE";
  conditions: { metric: string; status: string; actual: string | null; threshold: string | null }[];
};

export type CodeQualityOverview = {
  projectKey: string;
  available: boolean;
  capabilities: { branchAnalysis: boolean; pullRequestAnalysis: boolean };
  measures: CodeQualityMeasures | null;
  qualityGate: QualityGateStatus | null;
  developers: CodeQualityDeveloper[];
};

export async function getCodeQualityOverview(organizationId: string, projectKey: string) {
  const response = await api.get<{ overview: CodeQualityOverview }>("/api/code-quality/overview", {
    params: { organizationId, projectKey }
  });

  return response.data.overview;
}

/* --- SonarQube connection (per-org, manager-managed) --- */

export type CodeQualityConnection =
  | {
      connected: true;
      provider: string;
      baseUrl: string;
      organizationKey: string | null;
      status: string | null;
      lastCheckedAt: string | null;
    }
  | { connected: false; envFallback?: boolean };

export type SonarProjectSummary = { key: string; name: string };

export type CodeQualityConnectionInput = {
  organizationId: string;
  provider?: "sonarqube" | "sonarcloud";
  baseUrl: string;
  token: string;
  organizationKey?: string;
};

export async function getCodeQualityConnection(organizationId: string) {
  const response = await api.get<{ connection: CodeQualityConnection }>(
    "/api/code-quality/connection",
    { params: { organizationId } }
  );
  return response.data.connection;
}

export async function testCodeQualityConnection(input: CodeQualityConnectionInput) {
  const response = await api.post<{ result: { valid: boolean; status: string } }>(
    "/api/code-quality/connection/test",
    input
  );
  return response.data.result;
}

export async function saveCodeQualityConnection(input: CodeQualityConnectionInput) {
  const response = await api.put<{ connection: CodeQualityConnection }>(
    "/api/code-quality/connection",
    input
  );
  return response.data.connection;
}

export async function deleteCodeQualityConnection(organizationId: string) {
  const response = await api.delete<{ connection: CodeQualityConnection }>(
    "/api/code-quality/connection",
    { params: { organizationId } }
  );
  return response.data.connection;
}

export async function listSonarProjects(organizationId: string) {
  const response = await api.get<{ available: boolean; projects: SonarProjectSummary[] }>(
    "/api/code-quality/projects",
    { params: { organizationId } }
  );
  return response.data;
}

export type CodeQualitySummary =
  | { available: false; reason: "not_configured" | "no_project_mapped" | "unreachable" }
  | {
      available: true;
      projectCount: number;
      totals: { bugs: number; vulnerabilities: number; codeSmells: number; securityHotspots: number };
      coverage: number | null;
      worstGate: "OK" | "ERROR" | "WARN" | "NONE";
      projects: { key: string; bugs: number; vulnerabilities: number; coverage: number | null; gate: string }[];
    };

export async function getCodeQualitySummary(organizationId: string, projectId?: string) {
  const response = await api.get<{ summary: CodeQualitySummary }>("/api/code-quality/summary", {
    params: { organizationId, ...(projectId ? { projectId } : {}) }
  });
  return response.data.summary;
}

export type CodeQualityTrendPoint = {
  dayKey: string;
  capturedAt: string;
  bugs: number;
  vulnerabilities: number;
  codeSmells: number;
  coverage: number | null;
  gateStatus: string;
};

export async function getCodeQualityTrend(organizationId: string, projectKey: string, limit = 30) {
  const response = await api.get<{ trend: CodeQualityTrendPoint[] }>("/api/code-quality/trend", {
    params: { organizationId, projectKey, limit }
  });
  return response.data.trend;
}

/* ------------------------------------------------------------------ */
/* Collaboration / code-review metrics (pull requests + reviews)      */
/* ------------------------------------------------------------------ */

export type ReviewMetricsDeveloper = {
  login: string;
  employee: { userId: string; name: string } | null;
  prsOpened: number;
  prsMerged: number;
  reviewsGiven: number;
  approvals: number;
  changesRequested: number;
};

export type ReviewMetrics = {
  period: { from: string; to: string };
  totals: { prsOpened: number; prsMerged: number; reviewsGiven: number };
  developers: ReviewMetricsDeveloper[];
};

export async function getReviewMetrics(
  organizationId: string,
  options: { projectId?: string; from?: string; to?: string } = {}
) {
  const response = await api.get<{ metrics: ReviewMetrics }>("/api/pull-requests/review-metrics", {
    params: { organizationId, ...options }
  });
  return response.data.metrics;
}

export async function collectPullRequests(repositoryId: string) {
  const response = await api.post<{ result: { prCount: number; reviewCount: number } }>(
    "/api/pull-requests/collect",
    { repositoryId }
  );
  return response.data.result;
}

/* ------------------------------------------------------------------ */
/* Project analysis (manager-only per-employee activity cards)        */
/* ------------------------------------------------------------------ */

export type AnalysisEmployee = {
  rank: number;
  userId: string;
  name: string;
  email: string;
  projectRole: string;
  usernames: string[];
  hasGitIdentity: boolean;
  commits: number;
  additions: number;
  deletions: number;
  lines: number;
  /** Line count with lockfiles/generated/vendored files excluded. */
  filteredLines: number;
  excludedLines: number;
  activeDays: number;
  moduleCount: number;
  topModules: string[];
  categories: Record<string, number>;
  riskyCommits: number;
  largeCommits: number;
  lastCommitAt: string | null;
  sampleMessages: string[];
};

export type ProjectAnalysis = {
  period: { from: string; to: string };
  project: { id: string; name: string };
  daysInPeriod: number;
  truncated: boolean;
  totals: {
    commits: number;
    filteredLines: number;
    rawLines: number;
    activeContributors: number;
    members: number;
  };
  employees: AnalysisEmployee[];
  unmapped: { name: string; commits: number; filteredLines: number }[];
};

export type AnalysisPeriod = StatPeriod | "custom";

export type ProjectBranch = { name: string; isDefault: boolean };

export async function listProjectBranches(organizationId: string, projectId: string) {
  const response = await api.get<{ branches: ProjectBranch[] }>(
    "/api/analysis/project/branches",
    { params: { organizationId, projectId } }
  );

  return response.data.branches;
}

export async function getProjectAnalysis(
  organizationId: string,
  projectId: string,
  period: AnalysisPeriod = "last_30_days",
  customRange?: { from: string; to: string },
  branch?: string
) {
  const response = await api.get<{ analysis: ProjectAnalysis }>("/api/analysis/project", {
    params: {
      organizationId,
      projectId,
      period,
      ...(customRange ?? {}),
      ...(branch ? { branch } : {})
    }
  });

  return response.data.analysis;
}

/** One clickable commit backing an appraisal signal. */
export type AppraisalEvidence = {
  sha: string;
  message: string;
  committedAt: string;
  category: string;
  lines: number;
  sensitive: boolean;
  url: string;
};

/** Per-employee, evidence-backed appraisal (manager-only) for increment time. */
export type EmployeeAppraisal = {
  employee: {
    userId: string;
    name: string;
    email: string;
    usernames: string[];
    hasGitIdentity: boolean;
  };
  period: { from: string; to: string; months: number; days: number };
  scope: { type: "project"; name: string } | { type: "organization" };
  hasGitIdentity: boolean;
  truncated: boolean;
  headline: {
    commits: number;
    effectiveLines: number;
    rawLines: number;
    activeDays: number;
    firstCommitAt: string | null;
    lastCommitAt: string | null;
  } | null;
  consistency: {
    activeWeeks: number;
    totalWeeks: number;
    activeWeekPct: number;
    monthly: { month: string; commits: number; lines: number }[];
  };
  workMix: { text: string; top: { label: string; pct: number }[] };
  areas: string[];
  ownership: { sensitiveAreaCommits: number; moduleBreadth: number; criticalAreas: string[] };
  quality: {
    features: number;
    bugFixes: number;
    refactors: number;
    largeCommits: number;
    riskyCommits: number;
  };
  teamComparison: {
    teamSize: number;
    byRealWork: { rank: number; of: number };
    byCommits: { rank: number; of: number };
  } | null;
  codeQuality: {
    available: boolean;
    reason?: "not_configured" | "no_project_mapped" | "unreachable";
    projectKeys: string[];
    totals: { bugs: number; vulnerabilities: number; codeSmells: number; total: number };
    bySeverity: Record<string, number>;
    linesAuthored: number | null;
    perKLoc: number | null;
  };
  collaboration: {
    hasData: boolean;
    prsOpened: number;
    prsMerged: number;
    reviewsGiven: number;
    approvals: number;
    changesRequested: number;
  };
  evidence: AppraisalEvidence[];
  dataBlindSpots: string[];
};

export async function getEmployeeAppraisal(
  organizationId: string,
  userId: string,
  options: { projectId?: string; months?: number; from?: string; to?: string } = {}
) {
  const response = await api.get<{ appraisal: EmployeeAppraisal }>("/api/analysis/appraisal", {
    params: {
      organizationId,
      userId,
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.months ? { months: options.months } : {}),
      ...(options.from && options.to ? { from: options.from, to: options.to } : {})
    }
  });

  return response.data.appraisal;
}

/** One row of the per-employee commit details table. */
export type AnalysisCommit = {
  sha: string;
  message: string;
  committedAt: string;
  category: string;
  additions: number;
  deletions: number;
  changedFilesCount: number;
};

export async function getEmployeeCommits(
  organizationId: string,
  projectId: string,
  userId: string,
  period: AnalysisPeriod = "last_30_days",
  customRange?: { from: string; to: string },
  branch?: string
) {
  const response = await api.get<{ commits: AnalysisCommit[] }>(
    "/api/analysis/project/commits",
    {
      params: {
        organizationId,
        projectId,
        userId,
        period,
        ...(customRange ?? {}),
        ...(branch ? { branch } : {})
      }
    }
  );

  return response.data.commits;
}

/* ------------------------------------------------------------------ */
/* Daily digest (Phase 3b)                                            */
/* ------------------------------------------------------------------ */

export type DigestTopMover = {
  name: string;
  userId: string | null;
  usernames: string[];
  rank: number;
  commits: number;
  lines: number;
  rankDelta: number | null;
  streak: number;
};

export type DailyDigest = {
  date: string;
  range: { from: string; to: string };
  hasActivity: boolean;
  headline: {
    commits: number;
    additions: number;
    deletions: number;
    filesChanged: number;
    contributors: number;
    activeRepos: number;
  };
  trend: { commitsPrev: number; deltaPct: number | null };
  topMovers: DigestTopMover[];
  risks: string[];
  categories: Record<string, number>;
};

export async function getDailyDigest(organizationId: string) {
  const response = await api.get<{ digest: DailyDigest }>("/api/analysis/digest", {
    params: { organizationId }
  });

  return response.data.digest;
}

/* ------------------------------------------------------------------ */
/* Leaderboard history (Phase 3a)                                     */
/* ------------------------------------------------------------------ */

export type SnapshotGranularity = "DAILY" | "WEEKLY" | "MONTHLY";

export type LeaderboardSnapshotRow = {
  userId: string | null;
  name: string;
  usernames: string[];
  rank: number;
  commits: number;
  lines: number;
  filesChanged: number;
};

export type LeaderboardSnapshot = {
  id: string;
  scope: string;
  projectName: string | null;
  granularity: SnapshotGranularity;
  periodKey: string;
  rangeStart: string;
  rangeEnd: string;
  totalCommits: number;
  totalLines: number;
  contributors: number;
  rows: LeaderboardSnapshotRow[];
};

export async function getLeaderboardHistory(
  organizationId: string,
  scope = "org",
  granularity: SnapshotGranularity = "MONTHLY",
  limit = 12
) {
  const response = await api.get<{ snapshots: LeaderboardSnapshot[] }>(
    "/api/analysis/leaderboard-history",
    { params: { organizationId, scope, granularity, limit } }
  );

  return response.data.snapshots;
}

/* ------------------------------------------------------------------ */
/* Employee of the month (Phase 4b)                                   */
/* ------------------------------------------------------------------ */

export type AwardStatus = "SHORTLISTED" | "CONFIRMED" | "DISMISSED";

/** Plain-language "what they worked on" for non-technical readers. */
export type AwardDetails = {
  projects: string[];
  workType: string;
  areas: string[];
};

export type EmployeeAward = {
  id: string;
  scope: string;
  projectName: string | null;
  periodKey: string;
  rangeStart: string;
  rangeEnd: string;
  userId: string | null;
  name: string;
  usernames: string[];
  rank: number;
  score: number;
  commits: number;
  lines: number;
  activeDays: number;
  filesChanged: number;
  citation: string;
  detailsJson: AwardDetails | null;
  generatedBy: "llm" | "template" | null;
  status: AwardStatus;
  confirmedById: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

export type AwardShortlistResult = {
  periodKey: string;
  scope: string;
  projectName: string | null;
  generatedBy: "llm" | "template";
  awards: EmployeeAward[];
};

export async function listAwards(organizationId: string, scope?: string, limit = 24) {
  const response = await api.get<{ awards: EmployeeAward[] }>("/api/analysis/awards", {
    params: { organizationId, ...(scope ? { scope } : {}), limit }
  });

  return response.data.awards;
}

export async function generateAwardShortlist(
  organizationId: string,
  scope = "org",
  periodKey?: string
) {
  const response = await api.post<AwardShortlistResult>("/api/analysis/awards/shortlist", {
    organizationId,
    scope,
    ...(periodKey ? { periodKey } : {})
  });

  return response.data;
}

export async function confirmAward(awardId: string) {
  const response = await api.post<{ award: EmployeeAward }>(
    `/api/analysis/awards/${awardId}/confirm`,
    {}
  );

  return response.data.award;
}

/* ------------------------------------------------------------------ */
/* Notification channels — Telegram delivery (Phase 14c)              */
/* ------------------------------------------------------------------ */

export type ChannelType = "TELEGRAM";

export type NotificationChannel = {
  id: string;
  type: ChannelType;
  label: string;
  tokenLast4: string | null;
  chatId: string;
  chatTitle: string | null;
  enabled: boolean;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  lastDeliveryError: string | null;
  createdAt: string;
};

export type DetectedChat = { id: string; type: string; title: string };

export async function listChannels(organizationId: string) {
  const response = await api.get<{ channels: NotificationChannel[] }>("/api/channels", {
    params: { organizationId }
  });
  return response.data.channels;
}

/** Detect the chats a bot can currently see, from just its token (pre-save). */
export async function detectChats(organizationId: string, token: string) {
  const response = await api.post<{ chats: DetectedChat[] }>("/api/channels/detect", {
    organizationId,
    token
  });
  return response.data.chats;
}

export async function createChannel(input: {
  organizationId: string;
  label: string;
  token: string;
  chatId: string;
  chatTitle?: string;
}) {
  const response = await api.post<{ channel: NotificationChannel }>("/api/channels", input);
  return response.data.channel;
}

export async function updateChannel(
  id: string,
  patch: { label?: string; token?: string; chatId?: string; chatTitle?: string | null; enabled?: boolean }
) {
  const response = await api.patch<{ channel: NotificationChannel }>(`/api/channels/${id}`, patch);
  return response.data.channel;
}

export async function deleteChannel(id: string) {
  await api.delete(`/api/channels/${id}`);
}

export async function testChannel(id: string) {
  const response = await api.post<{ ok: boolean }>(`/api/channels/${id}/test`, {});
  return response.data;
}

export async function sendReportToChannel(channelId: string, reportId: string) {
  const response = await api.post<{ ok: boolean; messages: number }>("/api/channels/send-report", {
    channelId,
    reportId
  });
  return response.data;
}

/* ------------------------------------------------------------------ */
/* Scheduled reports (Phase 14a)                                      */
/* ------------------------------------------------------------------ */

export type ScheduleCadence = "DAILY" | "WEEKLY" | "MONTHLY";

export type ReportSchedule = {
  id: string;
  name: string;
  reportType: ReportType;
  repositoryId: string | null;
  projectId: string | null;
  employeeIds: string[];
  period: StatPeriod;
  cadence: ScheduleCadence;
  runHour: number;
  runMinute: number;
  timeZone: string | null;
  customPrompt: string | null;
  channelId: string | null;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastReportId: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdAt: string;
};

export type CreateScheduleInput = {
  organizationId: string;
  name: string;
  reportType: ReportType;
  repositoryId?: string;
  projectId?: string;
  employeeIds?: string[];
  period: StatPeriod;
  cadence: ScheduleCadence;
  runHour?: number;
  runMinute?: number;
  timeZone?: string;
  customPrompt?: string;
  channelId?: string | null;
};

export async function listSchedules(organizationId: string) {
  const response = await api.get<{ schedules: ReportSchedule[] }>("/api/schedules", {
    params: { organizationId }
  });
  return response.data.schedules;
}

export async function createSchedule(input: CreateScheduleInput) {
  const response = await api.post<{ schedule: ReportSchedule }>("/api/schedules", input);
  return response.data.schedule;
}

export async function updateSchedule(
  id: string,
  patch: {
    name?: string;
    period?: StatPeriod;
    cadence?: ScheduleCadence;
    enabled?: boolean;
    customPrompt?: string | null;
    channelId?: string | null;
  }
) {
  const response = await api.patch<{ schedule: ReportSchedule }>(`/api/schedules/${id}`, patch);
  return response.data.schedule;
}

export async function deleteSchedule(id: string) {
  await api.delete(`/api/schedules/${id}`);
}

export async function runScheduleNow(id: string) {
  const response = await api.post<{ reportId: string; status: string }>(
    `/api/schedules/${id}/run`,
    {}
  );
  return response.data;
}

export function getApiErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { error?: { message?: string } } } })
      .response;
    return response?.data?.error?.message ?? "Request failed";
  }

  return "Something went wrong";
}
