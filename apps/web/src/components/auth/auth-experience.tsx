"use client";

import { useEffect, useMemo, useState } from "react";
import { AxiosError } from "axios";

import {
  type AuthOrganization,
  type AuthUser,
  getCurrentUser,
  loginAccount,
  registerAccount
} from "@/lib/api";

type Mode = "register" | "login";

type SessionState = {
  accessToken: string;
  user: AuthUser;
  organizations: AuthOrganization[];
};

const tokenStorageKey = "devinsight.accessToken";

function getErrorMessage(error: unknown) {
  if (error instanceof AxiosError) {
    const data = error.response?.data as
      | { error?: { message?: string } }
      | undefined;

    return data?.error?.message ?? "Request failed";
  }

  return "Something went wrong";
}

export function AuthExperience() {
  const [mode, setMode] = useState<Mode>("register");
  const [session, setSession] = useState<SessionState | null>(null);
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);

  const isLoading = status === "loading";

  useEffect(() => {
    const token = window.localStorage.getItem(tokenStorageKey);

    if (!token) {
      return;
    }

    getCurrentUser(token)
      .then((result) => {
        setSession({
          accessToken: token,
          user: result.user,
          organizations: result.organizations
        });
      })
      .catch(() => {
        window.localStorage.removeItem(tokenStorageKey);
      })
      .finally(() => setStatus("idle"));
  }, []);

  const activeOrganization = useMemo(
    () => session?.organizations[0],
    [session?.organizations]
  );

  async function handleSubmit(formData: FormData) {
    setStatus("loading");
    setError(null);

    try {
      const email = String(formData.get("email") ?? "");
      const password = String(formData.get("password") ?? "");

      const result =
        mode === "register"
          ? await registerAccount({
              name: String(formData.get("name") ?? ""),
              organizationName: String(formData.get("organizationName") ?? ""),
              email,
              password
            })
          : await loginAccount({ email, password });

      window.localStorage.setItem(tokenStorageKey, result.accessToken);

      const currentUser = await getCurrentUser(result.accessToken);

      setSession({
        accessToken: result.accessToken,
        user: currentUser.user,
        organizations: currentUser.organizations
      });
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setStatus("idle");
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(tokenStorageKey);
    setSession(null);
    setMode("login");
  }

  return (
    <main className="min-h-screen bg-[#f6f4ef] px-5 py-8 text-[#161513] md:px-10">
      <section className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-7xl gap-8 lg:grid-cols-[1fr_480px] lg:items-center">
        <div className="max-w-3xl">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.24em] text-[#6f6a5f]">
            Developer Intelligence Platform
          </p>
          <h1 className="text-5xl font-semibold leading-[1.02] md:text-7xl">
            DevInsight AI
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#57534a]">
            Build the control plane first: secure users, organizations, and
            roles before connecting GitHub activity and OpenClaw reports.
          </p>
          <div className="mt-10 grid max-w-2xl gap-3 text-sm text-[#57534a] sm:grid-cols-3">
            <div className="border border-[#d8d1c3] bg-white p-4">
              <strong className="block text-[#161513]">NeonDB</strong>
              Prisma migration applied
            </div>
            <div className="border border-[#d8d1c3] bg-white p-4">
              <strong className="block text-[#161513]">Auth</strong>
              Register, login, me
            </div>
            <div className="border border-[#d8d1c3] bg-white p-4">
              <strong className="block text-[#161513]">Org</strong>
              Owner membership created
            </div>
          </div>
        </div>

        <div className="border border-[#d8d1c3] bg-white p-6 shadow-[12px_12px_0_#1f2937]">
          {session ? (
            <div>
              <div className="mb-8 flex items-start justify-between gap-4 border-b border-[#e5dfd3] pb-5">
                <div>
                  <p className="text-sm font-semibold text-[#6f6a5f]">
                    Signed in as
                  </p>
                  <h2 className="mt-1 text-2xl font-semibold">
                    {session.user.name}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="border border-[#d8d1c3] px-3 py-2 text-sm font-semibold transition hover:bg-[#f6f4ef]"
                >
                  Logout
                </button>
              </div>
              <dl className="grid gap-5 text-sm">
                <div>
                  <dt className="font-semibold text-[#161513]">Email</dt>
                  <dd className="mt-1 text-[#6f6a5f]">{session.user.email}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#161513]">Organization</dt>
                  <dd className="mt-1 text-[#6f6a5f]">
                    {activeOrganization?.name ?? "No organization"}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#161513]">Role</dt>
                  <dd className="mt-1 text-[#6f6a5f]">
                    {activeOrganization?.role ?? "N/A"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div>
              <div className="mb-6 grid grid-cols-2 border border-[#d8d1c3] p-1">
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className={`px-4 py-3 text-sm font-semibold transition ${
                    mode === "register"
                      ? "bg-[#161513] text-white"
                      : "text-[#57534a] hover:bg-[#f6f4ef]"
                  }`}
                >
                  Register
                </button>
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className={`px-4 py-3 text-sm font-semibold transition ${
                    mode === "login"
                      ? "bg-[#161513] text-white"
                      : "text-[#57534a] hover:bg-[#f6f4ef]"
                  }`}
                >
                  Login
                </button>
              </div>

              <form action={handleSubmit} className="grid gap-4">
                {mode === "register" ? (
                  <>
                    <label className="grid gap-2 text-sm font-semibold">
                      Name
                      <input
                        name="name"
                        required
                        minLength={2}
                        className="border border-[#d8d1c3] px-4 py-3 font-normal outline-none transition focus:border-[#161513]"
                        placeholder="Tanzil Mia"
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-semibold">
                      Organization
                      <input
                        name="organizationName"
                        required
                        minLength={2}
                        className="border border-[#d8d1c3] px-4 py-3 font-normal outline-none transition focus:border-[#161513]"
                        placeholder="DevInsight Labs"
                      />
                    </label>
                  </>
                ) : null}
                <label className="grid gap-2 text-sm font-semibold">
                  Email
                  <input
                    name="email"
                    type="email"
                    required
                    className="border border-[#d8d1c3] px-4 py-3 font-normal outline-none transition focus:border-[#161513]"
                    placeholder="you@example.com"
                  />
                </label>
                <label className="grid gap-2 text-sm font-semibold">
                  Password
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={mode === "register" ? 8 : 1}
                    className="border border-[#d8d1c3] px-4 py-3 font-normal outline-none transition focus:border-[#161513]"
                    placeholder="At least 8 characters"
                  />
                </label>

                {error ? (
                  <p className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-2 bg-[#161513] px-5 py-4 text-sm font-semibold text-white transition hover:bg-[#2b2924] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading
                    ? "Working..."
                    : mode === "register"
                      ? "Create workspace"
                      : "Enter dashboard"}
                </button>
              </form>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
