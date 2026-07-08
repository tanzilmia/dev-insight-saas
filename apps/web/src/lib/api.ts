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

export function getApiErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "response" in error) {
    const response = (error as { response?: { data?: { error?: { message?: string } } } })
      .response;
    return response?.data?.error?.message ?? "Request failed";
  }

  return "Something went wrong";
}

