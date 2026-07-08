import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json"
  }
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

