/**
 * Auto-surfaced "Key insights" (Report advance "B"). A pure, deterministic
 * rules pass over the activity/analysis/comparison that highlights notable
 * signals — volume swings, concentration, risks, work-type skew, and roster
 * changes — so a manager sees what matters without reading the whole report.
 */
import type { ReportComparison } from "./comparison.js";

export type InsightSeverity = "info" | "warn";

export type Insight = {
  kind: string;
  severity: InsightSeverity;
  text: string;
};

export type InsightLeader = {
  name: string;
  lines: number;
};

const VOLUME_SWING_PCT = 25;
const CONCENTRATION_PCT = 60;
const WORKTYPE_SKEW_PCT = 50;
const OFF_HOURS_PCT = 30;
const NOISE_SHARE_PCT = 50;
const MAX_INSIGHTS = 6;
const SKEW_CATEGORIES = new Set(["Fix", "Feature", "Refactor", "Docs", "Test", "Chore"]);

export function buildInsights(input: {
  activity: { commits: number };
  analysis?: {
    categories: Record<string, number>;
    risks: string[];
    analyzedCommits?: number;
    offHoursCommits?: number;
    noiseChangeShare?: number;
  } | null;
  leaderboard: InsightLeader[];
  comparison?: ReportComparison | null;
}): Insight[] {
  const insights: Insight[] = [];
  const { analysis, leaderboard, comparison } = input;

  // 1. Volume trend vs the previous period.
  if (comparison?.hasBaseline && comparison.commits.deltaPct !== null) {
    const pct = comparison.commits.deltaPct;
    if (Math.abs(pct) >= VOLUME_SWING_PCT) {
      insights.push({
        kind: "volume",
        severity: pct < 0 ? "warn" : "info",
        text: `Commit volume ${pct > 0 ? "up" : "down"} ${Math.abs(pct)}% vs the previous period (${comparison.commits.previous} → ${comparison.commits.current}).`
      });
    }
  }

  // 2. Risk signals (from the analysis engine) — high-priority, surfaced early
  // so they are never crowded out of the capped list by lower-value insights.
  for (const risk of (analysis?.risks ?? []).slice(0, 2)) {
    insights.push({ kind: "risk", severity: "warn", text: risk });
  }

  // 3. Work concentration (bus-factor signal).
  const totalLines = leaderboard.reduce((sum, row) => sum + row.lines, 0);
  if (leaderboard.length > 1 && totalLines > 0) {
    const top = leaderboard[0]!;
    const share = Math.round((top.lines / totalLines) * 100);
    if (share >= CONCENTRATION_PCT) {
      insights.push({
        kind: "concentration",
        severity: "warn",
        text: `${top.name} produced ${share}% of the changes — work is concentrated on one person.`
      });
    }
  }

  // 3. New / departed contributors vs last period.
  const news = (comparison?.movers ?? []).filter((m) => m.status === "new");
  const dropped = (comparison?.movers ?? []).filter((m) => m.status === "dropped");
  if (news.length) {
    insights.push({
      kind: "new-contributor",
      severity: "info",
      text: `New on the board this period: ${news.slice(0, 3).map((m) => m.name).join(", ")}.`
    });
  }
  if (dropped.length) {
    insights.push({
      kind: "dropped-contributor",
      severity: "warn",
      text: `Went quiet vs last period: ${dropped.slice(0, 3).map((m) => m.name).join(", ")}.`
    });
  }

  // 4. Notable climber.
  const riser = (comparison?.movers ?? [])
    .filter((m) => m.status === "up" && (m.delta ?? 0) >= 2)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
  if (riser) {
    insights.push({
      kind: "riser",
      severity: "info",
      text: `${riser.name} climbed ${riser.delta} place${riser.delta === 1 ? "" : "s"} on the leaderboard.`
    });
  }

  // 5. Work-type skew.
  if (analysis?.categories) {
    const entries = Object.entries(analysis.categories).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    if (total > 0 && entries.length) {
      const [topCat, topCount] = entries[0]!;
      const share = Math.round((topCount / total) * 100);
      if (share >= WORKTYPE_SKEW_PCT && SKEW_CATEGORIES.has(topCat)) {
        insights.push({
          kind: "worktype",
          severity: "info",
          text: `Work skewed toward ${topCat} (${share}% of classified commits).`
        });
      }
    }
  }

  // 7. Off-hours / weekend work (wellbeing signal).
  const analyzed = analysis?.analyzedCommits ?? 0;
  const offHours = analysis?.offHoursCommits ?? 0;
  if (analyzed >= 5 && offHours > 0) {
    const share = Math.round((offHours / analyzed) * 100);
    if (share >= OFF_HOURS_PCT) {
      insights.push({
        kind: "off-hours",
        severity: "warn",
        text: `${share}% of commits landed late-night or on a weekend — watch for burnout.`
      });
    }
  }

  // 8. Dependency / generated-file churn (volume looks bigger than the real work).
  if (analysis?.noiseChangeShare !== undefined && analysis.noiseChangeShare >= NOISE_SHARE_PCT / 100) {
    insights.push({
      kind: "dependency-churn",
      severity: "info",
      text: `${Math.round(analysis.noiseChangeShare * 100)}% of changed lines were in dependency/generated files — real feature churn is smaller than the totals suggest.`
    });
  }

  return insights.slice(0, MAX_INSIGHTS);
}
