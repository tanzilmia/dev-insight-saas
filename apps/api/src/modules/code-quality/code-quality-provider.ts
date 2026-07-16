/**
 * Code-quality provider abstraction — static-analysis metrics (bugs, coverage,
 * per-author issues) behind one interface, exactly like `LLMProvider` and
 * `GitProvider`. Self-hosted SonarQube is the only implementation today;
 * SonarCloud slots in behind this without touching callers — the difference
 * (base URL, `organization` param, branch/PR features) is confined to the impl
 * and env. Callers must NEVER talk to a SonarQube/SonarCloud HTTP API directly.
 */

/** Letter ratings SonarQube reports (A best … E worst); null when unmeasured. */
export type QualityRating = "A" | "B" | "C" | "D" | "E" | null;

/** Project-level headline metrics from the latest analysis. */
export type QualityMeasures = {
  linesOfCode: number | null;
  bugs: number | null;
  vulnerabilities: number | null;
  securityHotspots: number | null;
  codeSmells: number | null;
  coverage: number | null; // percent
  duplicatedLinesDensity: number | null; // percent
  techDebtMinutes: number | null;
  reliabilityRating: QualityRating;
  securityRating: QualityRating;
  maintainabilityRating: QualityRating;
};

/**
 * Issues attributed to one git author (SCM-blame email). This is what enables
 * per-developer analysis; DevInsight joins `author` to an employee via the
 * existing git-mapping/alias tables. Attribution is blame-based (last toucher),
 * so treat it as fair evidence, not exact fault.
 */
export type AuthorIssueBreakdown = {
  author: string; // git email as recorded by SonarQube blame
  total: number;
  bugs: number;
  vulnerabilities: number;
  codeSmells: number;
  bySeverity: Record<string, number>; // e.g. { CRITICAL: 4, MAJOR: 10, ... }
};

/**
 * Feature capabilities that differ by edition. Community Edition analyzes the
 * main branch only; SonarCloud/Developer Edition add branch & PR analysis. The
 * UI gates PR/branch features on these flags so switching provider lights them
 * up with zero component changes.
 */
export type CodeQualityCapabilities = {
  readonly branchAnalysis: boolean;
  readonly pullRequestAnalysis: boolean;
};

/** Runtime configuration for a provider instance (per-org or env fallback). */
export type CodeQualityConfig = {
  baseUrl: string;
  token: string | null;
  organizationKey: string | null;
};

/** Quality gate outcome — the single pass/fail signal, with failed conditions. */
export type QualityGateStatus = {
  status: "OK" | "ERROR" | "WARN" | "NONE";
  conditions: { metric: string; status: string; actual: string | null; threshold: string | null }[];
};

/** A project as listed by the server (for the mapping dropdown). */
export type SonarProjectSummary = { key: string; name: string };

export interface CodeQualityProvider {
  /** True when the provider is configured (base URL + token present). */
  readonly available: boolean;
  readonly capabilities: CodeQualityCapabilities;
  /** Headline metrics for a project's latest analysis. */
  getMeasures(projectKey: string): Promise<QualityMeasures>;
  /** Open issues grouped by git author, for per-developer analysis. */
  getIssuesByAuthor(projectKey: string): Promise<AuthorIssueBreakdown[]>;
  /** Quality gate status (pass/fail) for a project. */
  getQualityGate(projectKey: string): Promise<QualityGateStatus>;
  /** Projects visible to the configured token (for repo→project mapping). */
  listProjects(): Promise<SonarProjectSummary[]>;

  // --- Provisioning (multi-tenant auto-scan). Optional: needs an admin /
  // create-project-capable token, so only the self-hosted SonarQube impl wires
  // these. Callers guard on their presence. ---
  /**
   * Ensures a project with this key exists (idempotent — an already-existing
   * project is treated as success). Needs "Create Projects" / admin permission.
   */
  ensureProject?(projectKey: string, name: string): Promise<void>;
  /**
   * Generates a fresh project-scoped analysis token, revoking any prior token of
   * the same name first so the operation is repeatable. Returns the token value
   * (shown by SonarQube only once — the caller must store/inject it immediately).
   */
  generateProjectToken?(projectKey: string, tokenName: string): Promise<string>;
}
