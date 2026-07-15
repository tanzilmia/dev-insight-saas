import { AppError } from "../../common/errors/app-error.js";

import type {
  AuthorIssueBreakdown,
  CodeQualityCapabilities,
  CodeQualityConfig,
  CodeQualityProvider,
  QualityGateStatus,
  QualityMeasures,
  QualityRating,
  SonarProjectSummary
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

type SonarIssuesResponse = { total?: number; issues?: SonarIssue[] };

type SonarGateResponse = {
  projectStatus?: {
    status?: string;
    conditions?: {
      metricKey?: string;
      status?: string;
      actualValue?: string;
      errorThreshold?: string;
    }[];
  };
};

type SonarComponentsResponse = { components?: { key?: string; name?: string }[] };

/**
 * SonarQube (Community Edition) implementation, driven by an explicit config so
 * one class serves both a per-org saved connection and the env fallback. Works
 * unchanged against SonarCloud: set `organizationKey` and it is appended to every
 * request (SonarCloud requires it; self-hosted ignores an absent one).
 */
export class SonarQubeProvider implements CodeQualityProvider {
  constructor(private readonly config: CodeQualityConfig) {}

  get available(): boolean {
    return Boolean(this.config.token);
  }

  // Community Edition: main branch only. Pointed at SonarCloud (organizationKey
  // set) these flip on — a config change, not a code change.
  get capabilities(): CodeQualityCapabilities {
    const isCloud = Boolean(this.config.organizationKey);
    return { branchAnalysis: isCloud, pullRequestAnalysis: isCloud };
  }

  private async apiGet<T>(path: string, params: Record<string, string>): Promise<T> {
    if (!this.config.token) {
      throw new AppError(400, "SonarQube is not configured", "CODE_QUALITY_NOT_CONFIGURED");
    }

    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (this.config.organizationKey) url.searchParams.set("organization", this.config.organizationKey);

    // Token-as-username Basic auth (empty password) — same as `curl -u token:`.
    const auth = Buffer.from(`${this.config.token}:`).toString("base64");

    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    } catch {
      throw new AppError(502, "Could not reach SonarQube", "CODE_QUALITY_UNREACHABLE");
    }

    if (response.status === 401 || response.status === 403) {
      throw new AppError(401, "SonarQube rejected the token", "CODE_QUALITY_UNAUTHORIZED");
    }
    if (response.status === 404) {
      throw new AppError(404, "SonarQube project not found", "CODE_QUALITY_PROJECT_NOT_FOUND");
    }
    if (!response.ok) {
      throw new AppError(502, `SonarQube request failed (${response.status})`, "CODE_QUALITY_ERROR");
    }

    return (await response.json()) as T;
  }

  /** Lightweight token check for the connect flow. Never throws. */
  async validate(): Promise<boolean> {
    try {
      const data = await this.apiGet<{ valid?: boolean }>("/api/authentication/validate", {});
      return data.valid === true;
    } catch {
      return false;
    }
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

  async getQualityGate(projectKey: string): Promise<QualityGateStatus> {
    const data = await this.apiGet<SonarGateResponse>("/api/qualitygates/project_status", {
      projectKey
    });
    const raw = (data.projectStatus?.status ?? "NONE").toUpperCase();
    const status: QualityGateStatus["status"] =
      raw === "OK" || raw === "ERROR" || raw === "WARN" ? raw : "NONE";
    return {
      status,
      conditions: (data.projectStatus?.conditions ?? []).map((c) => ({
        metric: c.metricKey ?? "",
        status: c.status ?? "",
        actual: c.actualValue ?? null,
        threshold: c.errorThreshold ?? null
      }))
    };
  }

  async listProjects(): Promise<SonarProjectSummary[]> {
    // components/search (qualifier TRK) is readable by any authenticated user,
    // unlike projects/search which needs admin.
    const data = await this.apiGet<SonarComponentsResponse>("/api/components/search", {
      qualifiers: "TRK",
      ps: "500"
    });
    return (data.components ?? [])
      .filter((c): c is { key: string; name?: string } => Boolean(c.key))
      .map((c) => ({ key: c.key, name: c.name ?? c.key }));
  }
}
