"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AxiosError } from "axios";
import { GitBranch, Lock, ShieldCheck, Sparkles } from "lucide-react";

import { getCurrentUser, loginAccount, registerAccount } from "@/lib/api";
import { getStoredToken, storeToken } from "@/lib/auth-storage";

type Mode = "login" | "register";

const highlights = [
  { icon: ShieldCheck, text: "Organization-scoped roles and access" },
  { icon: GitBranch, text: "Git-ready contributor mapping" },
  { icon: Sparkles, text: "OpenClaw-powered reporting path" }
];

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
  const fieldClass =
    "field w-full rounded-2xl px-4 py-3 font-medium text-(--text) placeholder:font-normal";

  return (
    <section className="grid min-h-screen place-items-center px-5 py-24">
      <div className="grid w-full max-w-6xl gap-10 lg:grid-cols-[1fr_460px] lg:items-center">
        <div className="animate-rise max-w-2xl">
          <span className="glass-soft mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-black uppercase tracking-[0.28em] text-(--accent)">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-(--accent)" />
            Secure workspace access
          </span>
          <h1 className="text-5xl font-black leading-[0.98] tracking-tight text-(--text) md:text-7xl">
            Sign in to your{" "}
            <span className="text-gradient">intelligence cockpit.</span>
          </h1>
          <p className="mt-6 text-lg leading-8 text-(--muted)">
            Connect your organization first, then bring in Git activity,
            contributor mapping, and OpenClaw-powered reports.
          </p>

          <ul className="mt-8 grid gap-3">
            {highlights.map((item) => (
              <li key={item.text} className="flex items-center gap-3">
                <span className="glass grid h-9 w-9 shrink-0 place-items-center rounded-xl text-(--accent)">
                  <item.icon size={17} />
                </span>
                <span className="text-sm font-bold text-(--muted)">
                  {item.text}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="glass animate-rise rounded-4xl p-6 [animation-delay:120ms] md:p-7">
          <div className="mb-6 flex items-center gap-2 text-(--muted)">
            <Lock size={16} />
            <span className="text-xs font-black uppercase tracking-[0.2em]">
              {mode === "register" ? "Create account" : "Welcome back"}
            </span>
          </div>

          <div className="glass-soft mb-6 grid grid-cols-2 rounded-full p-1">
            {(["login", "register"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className={`rounded-full px-4 py-2.5 text-sm font-bold capitalize transition ${
                  mode === option
                    ? "btn-gradient"
                    : "text-(--muted) hover:text-(--text)"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <form action={handleSubmit} className="grid gap-4">
            {mode === "register" ? (
              <>
                <label className="grid gap-2 text-sm font-bold text-(--text)">
                  Name
                  <input
                    name="name"
                    required
                    minLength={2}
                    className={fieldClass}
                    placeholder="Tanzil Mia"
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-(--text)">
                  Organization
                  <input
                    name="organizationName"
                    required
                    minLength={2}
                    className={fieldClass}
                    placeholder="DevInsight Labs"
                  />
                </label>
              </>
            ) : null}
            <label className="grid gap-2 text-sm font-bold text-(--text)">
              Email
              <input
                name="email"
                type="email"
                required
                className={fieldClass}
                placeholder="you@example.com"
              />
            </label>
            <label className="grid gap-2 text-sm font-bold text-(--text)">
              Password
              <input
                name="password"
                type="password"
                required
                minLength={mode === "register" ? 8 : 1}
                className={fieldClass}
                placeholder="At least 8 characters"
              />
            </label>

            {error ? (
              <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={disabled}
              className="btn-gradient mt-2 rounded-2xl px-5 py-4 text-sm font-black"
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
