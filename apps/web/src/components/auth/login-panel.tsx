"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AxiosError } from "axios";

import { getCurrentUser, loginAccount, registerAccount } from "@/lib/api";
import { getStoredToken, storeToken } from "@/lib/auth-storage";

type Mode = "login" | "register";

function getErrorMessage(error: unknown) {
  if (error instanceof AxiosError) {
    const data = error.response?.data as
      | { error?: { message?: string } }
      | undefined;

    return data?.error?.message ?? "Request failed";
  }

  return "Something went wrong";
}

export function LoginPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const token = getStoredToken();

    if (!token) {
      return;
    }

    getCurrentUser(token)
      .then(() => {
        startTransition(() => router.replace("/dashboard"));
      })
      .catch(() => {
        window.localStorage.removeItem("devinsight.accessToken");
      });
  }, [router]);

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
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

      storeToken(result.accessToken);
      startTransition(() => router.replace("/dashboard"));
    } catch (caughtError) {
      setError(getErrorMessage(caughtError));
    } finally {
      setIsSubmitting(false);
    }
  }

  const disabled = isSubmitting || isPending;

  return (
    <section className="grid min-h-screen place-items-center px-5 py-24">
      <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[1fr_460px] lg:items-center">
        <div className="max-w-2xl">
          <p className="mb-5 text-xs font-black uppercase tracking-[0.35em] text-[var(--accent)]">
            Secure workspace access
          </p>
          <h1 className="text-5xl font-black leading-[0.98] tracking-tight md:text-7xl">
            Sign in to your engineering intelligence cockpit.
          </h1>
          <p className="mt-6 text-lg leading-8 text-[var(--muted)]">
            Connect your organization first, then bring in Git activity,
            contributor mapping, and OpenClaw-powered reports.
          </p>
        </div>

        <div className="rounded-[2rem] border border-[var(--border)] bg-[var(--glass)] p-6 shadow-2xl shadow-black/10 backdrop-blur-2xl">
          <div className="mb-6 grid grid-cols-2 rounded-full border border-[var(--border)] bg-[var(--surface-soft)] p-1">
            {(["login", "register"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`rounded-full px-4 py-3 text-sm font-bold capitalize transition ${
                  mode === option
                    ? "bg-[var(--text)] text-[var(--surface)]"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <form action={handleSubmit} className="grid gap-4">
            {mode === "register" ? (
              <>
                <label className="grid gap-2 text-sm font-bold">
                  Name
                  <input
                    name="name"
                    required
                    minLength={2}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--field)] px-4 py-3 font-medium outline-none transition focus:border-[var(--accent)]"
                    placeholder="Tanzil Mia"
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold">
                  Organization
                  <input
                    name="organizationName"
                    required
                    minLength={2}
                    className="rounded-2xl border border-[var(--border)] bg-[var(--field)] px-4 py-3 font-medium outline-none transition focus:border-[var(--accent)]"
                    placeholder="DevInsight Labs"
                  />
                </label>
              </>
            ) : null}
            <label className="grid gap-2 text-sm font-bold">
              Email
              <input
                name="email"
                type="email"
                required
                className="rounded-2xl border border-[var(--border)] bg-[var(--field)] px-4 py-3 font-medium outline-none transition focus:border-[var(--accent)]"
                placeholder="you@example.com"
              />
            </label>
            <label className="grid gap-2 text-sm font-bold">
              Password
              <input
                name="password"
                type="password"
                required
                minLength={mode === "register" ? 8 : 1}
                className="rounded-2xl border border-[var(--border)] bg-[var(--field)] px-4 py-3 font-medium outline-none transition focus:border-[var(--accent)]"
                placeholder="At least 8 characters"
              />
            </label>

            {error ? (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={disabled}
              className="mt-2 rounded-2xl bg-[var(--text)] px-5 py-4 text-sm font-black text-[var(--surface)] transition hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {disabled
                ? "Working..."
                : mode === "register"
                  ? "Create workspace"
                  : "Login and go dashboard"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

