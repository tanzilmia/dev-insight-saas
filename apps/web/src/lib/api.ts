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

export async function deleteCredential(credentialId: string) {
  const response = await api.delete<{ id: string }>(
    `/api/git-credentials/${credentialId}`
  );

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
  commitCount: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CollectActivityResult = {
  range: { since: string; until: string };
  newCollected: number;
  branchesChecked: number;
  branchesCollected: number;
  rangesCollected: number;
};

export async function collectActivity(repositoryId: string) {
  const response = await api.post<{ activity: CollectActivityResult }>(
    `/api/repositories/${repositoryId}/activity`,
    {}
  );

  return response.data.activity;
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
