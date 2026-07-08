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
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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

export function getApiErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { error?: { message?: string } } } })
      .response;
    return response?.data?.error?.message ?? "Request failed";
  }

  return "Something went wrong";
}

