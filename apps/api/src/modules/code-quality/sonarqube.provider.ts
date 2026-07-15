import { AppError } from "../../common/errors/app-error.js";
import { env } from "../../config/env.js";

import type {
  AuthorIssueBreakdown,
  CodeQualityCapabilities,
  CodeQualityProvider,
  QualityMeasures,
  QualityRating
} from "./code-quality-provider.js";

/** SonarQube ratings come back as "1.0".."5.0"; map to letters. */
const RATING_LETTER: Record<string, QualityRating> = {
  "1.0": "A",
  "2.0": "B",
  "3.0": "C",
  "4.0": "D",
  "5.0": "E"
};

const MEASURE_METRICS = [
  "ncloc",
  "bugs",
  "vulnerabilities",
  "security_hotspots",
  "code_smells",
  "coverage",
  "duplicated_lines_density",
  "sqale_index",
  "reliability_rating",
  "security_rating",
  "sqale_rating"
];

const ISSUES_PAGE_SIZE = 500;
// SonarQube caps issue pagination at 10k; stop well before to bound the work.
const MAX_ISSUE_PAGES = 20;

type SonarMeasuresResponse = {
  component?: { measures?: { metric: string; value?: string }[] };
};

type SonarIssue = {
  author?: string;
  type?: string; // BUG | VULNERABILITY | CODE_SMELL
  severity?: string; // BLOCKER | CRITICAL | MAJOR | MINOR | INFO
};

type SonarIssuesResponse = {
  total?: number;
  issues?: SonarIssue[];
};

/**
 * Self-hosted SonarQube (Community Edition) implementation. Reads the Web API
 * with a server-side token (Basic auth, `token:`). Works unchanged against a
 * SonarCloud host too — set `SONAR_ORGANIZATION` and it is appended to every
 * request (SonarCloud requires it; self-hosted ignores an absent one).
 */
export class SonarQubeProvider implements CodeQualityProvider {
  get available(): boolean {
    return Boolean(env.SONAR_TOKEN);
  }

  // Community Edition: main branch only. When pointed at SonarCloud these flip
  // on (a config change, not a code change).
  get capabilities(): CodeQualityCapabilities {
    const isCloud = Boolean(env.SONAR_ORGANIZATION);
    return { branchAnalysis: isCloud, pullRequestAnalysis: isCloud };
  }

  private async apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!env.SONAR_TOKEN) {
      throw new AppError(400, "SonarQube is not configured", "CODE_QUALITY_NOT_CONFIGURED");
    }

    const url = new URL(path, env.SONAR_BASE_URL);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (env.SONAR_ORGANIZATION) url.searchParams.set("organization", env.SONAR_ORGANIZATION);

    // Token-as-username Basic auth (empty password) — same as `curl -u token:`.
    const auth = Buffer.from(`${env.SONAR_TOKEN}:`).toString("base64");

    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    } catch {
      throw new AppError(502, "Could not reach SonarQube", "CODE_QUALITY_UNREACHABLE");
    }

    if (response.status === 404) {
      throw new AppError(404, "SonarQube project not found", "CODE_QUALITY_PROJECT_NOT_FOUND");
    }
    if (!response.ok) {
      throw new AppError(
        502,
        `SonarQube request failed (${response.status})`,
        "CODE_QUALITY_ERROR"
      );
    }

    return (await response.json()) as T;
  }

  async getMeasures(projectKey: string): Promise<QualityMeasures> {
    const data = await this.apiGet<SonarMeasuresResponse>("/api/measures/component", {
      component: projectKey,
      metricKeys: MEASURE_METRICS.join(",")
    });

    const raw = new Map<string, string>();
    for (const m of data.component?.measures ?? []) {
      if (m.value !== undefined) raw.set(m.metric, m.value);
    }

    const num = (metric: string): number | null => {
      const v = raw.get(metric);
      if (v === undefined) return null;
      const parsed = Number(v);
      return Number.isNaN(parsed) ? null : parsed;
    };
    const rating = (metric: string): QualityRating => RATING_LETTER[raw.get(metric) ?? ""] ?? null;

    return {
      linesOfCode: num("ncloc"),
      bugs: num("bugs"),
      vulnerabilities: num("vulnerabilities"),
      securityHotspots: num("security_hotspots"),
      codeSmells: num("code_smells"),
      coverage: num("coverage"),
      duplicatedLinesDensity: num("duplicated_lines_density"),
      techDebtMinutes: num("sqale_index"),
      reliabilityRating: rating("reliability_rating"),
      securityRating: rating("security_rating"),
      maintainabilityRating: rating("sqale_rating")
    };
  }

  async getIssuesByAuthor(projectKey: string): Promise<AuthorIssueBreakdown[]> {
    const byAuthor = new Map<string, AuthorIssueBreakdown>();

    for (let page = 1; page <= MAX_ISSUE_PAGES; page++) {
      const data = await this.apiGet<SonarIssuesResponse>("/api/issues/search", {
        componentKeys: projectKey,
        resolved: "false",
        ps: String(ISSUES_PAGE_SIZE),
        p: String(page)
      });

      const issues = data.issues ?? [];
      for (const issue of issues) {
        const author = issue.author?.trim() || "(unattributed)";
        let entry = byAuthor.get(author);
        if (!entry) {
          entry = { author, total: 0, bugs: 0, vulnerabilities: 0, codeSmells: 0, bySeverity: {} };
          byAuthor.set(author, entry);
        }
        entry.total += 1;
        if (issue.type === "BUG") entry.bugs += 1;
        else if (issue.type === "VULNERABILITY") entry.vulnerabilities += 1;
        else if (issue.type === "CODE_SMELL") entry.codeSmells += 1;
        if (issue.severity) entry.bySeverity[issue.severity] = (entry.bySeverity[issue.severity] ?? 0) + 1;
      }

      const total = data.total ?? 0;
      if (page * ISSUES_PAGE_SIZE >= total || issues.length === 0) break;
    }

    return [...byAuthor.values()].sort((a, b) => b.total - a.total);
  }
}
