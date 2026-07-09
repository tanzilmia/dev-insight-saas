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

export type Employee = {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  status: "ACTIVE" | "INVITED" | "DISABLED";
  joinedAt: string;
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
}) {
  const response = await api.post<{ employee: Employee }>("/api/employees", input);
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
  totalInRange: number;
  newCollected: number;
  detailCapped: number;
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
export type ReportPeriod = "today" | "last_7_days" | "last_30_days" | "custom";
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
  status: ReportStatus;
  pending: string[];
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

/* ------------------------------------------------------------------ */
/* OpenClaw assistant (website chat)                                  */
/* ------------------------------------------------------------------ */

export async function getChatStatus() {
  const response = await api.get<{ configured: boolean }>("/api/openclaw/chat/status");
  return response.data.configured;
}

export async function sendAssistantMessage(organizationId: string, message: string) {
  const response = await api.post<{ reply: string }>("/api/openclaw/chat", {
    organizationId,
    message
  });

  return response.data.reply;
}

export function getApiErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { error?: { message?: string } } } })
      .response;
    return response?.data?.error?.message ?? "Request failed";
  }

  return "Something went wrong";
}
