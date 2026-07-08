"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const themeStorageKey = "devinsight.theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem(themeStorageKey);

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  return (
    <div className="min-h-full">
      <button
        type="button"
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        className="fixed right-4 top-4 z-50 rounded-full border border-white/20 bg-[var(--glass)] px-4 py-2 text-xs font-semibold text-[var(--text)] shadow-lg shadow-black/10 backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-[var(--glass-strong)]"
        aria-label="Toggle color theme"
      >
        {theme === "dark" ? "Light" : "Dark"}
      </button>
      {children}
    </div>
  );
}

