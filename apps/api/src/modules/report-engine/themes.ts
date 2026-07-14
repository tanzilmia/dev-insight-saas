import type { ChatMessage } from "../llm/llm-provider.js";

/**
 * A structured "what shipped" initiative — related commits grouped into one named
 * piece of work. Produced by a dedicated LLM call (Phase 2.5) so it can render as
 * a structured panel, unlike the prose "## What shipped" section woven into the
 * report markdown. Fully optional: a missing/failed LLM just yields `[]`.
 */
export type ReportTheme = {
  title: string;
  summary: string;
  size: "small" | "medium" | "large";
};

export type ThemeCommit = { message: string; author: string | null };

const MAX_THEMES = 6;
const MAX_TITLE = 80;
const MAX_SUMMARY = 240;
const MAX_COMMIT_LINES = 120;

/**
 * Builds the prompt for the structured theme-clustering call. Asks for a strict
 * JSON array so the result can be parsed into `ReportTheme[]` — grounded only in
 * the real commit messages, never invented.
 */
export function buildThemesPrompt(commits: ThemeCommit[]): ChatMessage[] {
  const lines = commits
    .slice(0, MAX_COMMIT_LINES)
    .map((commit) => `- ${commit.message.split("\n")[0]}`)
    .join("\n");

  return [
    {
      role: "system",
      content:
        "You group a team's Git commit messages into concrete pieces of shipped work (initiatives). " +
        "You reply with ONLY a JSON array — no prose, no markdown fences."
    },
    {
      role: "user",
      content:
        "Read the commit messages below and group related ones into 3-6 concrete initiatives " +
        "(features, fixes, or bodies of work). For each, return an object with:\n" +
        '- "title": a short plain-language name (no jargon, no commit prefixes)\n' +
        '- "summary": one sentence on what it delivered, in business language\n' +
        '- "size": "small" | "medium" | "large" (rough amount of work)\n\n' +
        "Base every initiative ONLY on the actual messages — never invent work. Merge related " +
        "commits into one initiative. Ignore pure chores (dependency bumps, lint, formatting) " +
        "unless nothing else is present. Reply with ONLY the JSON array.\n\n" +
        `Commit messages:\n${lines}`
    }
  ];
}

/** Robustly parses the LLM's reply into themes: tolerant of fences/preamble. */
export function parseThemes(raw: string): ReportTheme[] {
  if (!raw) return [];

  // Strip code fences and isolate the first bracketed array.
  const withoutFences = raw.replace(/```(?:json)?/gi, "").trim();
  const start = withoutFences.indexOf("[");
  const end = withoutFences.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFences.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const themes: ReportTheme[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    if (!title) continue;
    const sizeRaw = typeof item.size === "string" ? item.size.toLowerCase() : "";
    const size: ReportTheme["size"] =
      sizeRaw === "small" || sizeRaw === "large" ? sizeRaw : "medium";
    themes.push({
      title: title.slice(0, MAX_TITLE),
      summary: summary.slice(0, MAX_SUMMARY),
      size
    });
    if (themes.length >= MAX_THEMES) break;
  }
  return themes;
}
