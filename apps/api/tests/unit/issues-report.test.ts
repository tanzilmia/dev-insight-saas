import { describe, expect, it } from "vitest";

import {
  buildReportMarkdown,
  type ReportContext
} from "../../src/modules/openclaw/openclaw.tools.js";

describe("GitHub Issue report signals", () => {
  it("adds a deterministic work-tracking section to report output", () => {
    const context: ReportContext = {
      reportType: "repository",
      range: {
        from: new Date("2026-07-01T00:00:00Z"),
        to: new Date("2026-07-31T00:00:00Z")
      },
      repository: { id: "repo-1", fullName: "acme/devinside" },
      employees: [],
      activity: {
        commits: 4,
        additions: 100,
        deletions: 20,
        filesChanged: 8,
        lastCommitAt: null,
        lastSha: null
      },
      sampleCommits: [],
      issueMetrics: {
        open: 5,
        opened: 3,
        closed: 2,
        unassignedOpen: 1,
        overdueOpen: 2,
        avgAgeDays: 18.5,
        avgCycleDays: 6
      }
    };

    const report = buildReportMarkdown(context).markdown;

    expect(report).toContain("## Work tracking");
    expect(report).toContain("Open backlog: 5; opened: 3; closed: 2.");
    expect(report).toContain("not a standalone performance score");
  });
});
