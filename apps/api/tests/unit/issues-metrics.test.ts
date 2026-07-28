import { describe, expect, it } from "vitest";

import { calculateIssueMetrics } from "../../src/modules/issues/issues.service.js";

describe("calculateIssueMetrics", () => {
  it("calculates backlog, aging, cycle time, labels, and mapped workload", () => {
    const from = new Date("2026-07-01T00:00:00Z");
    const to = new Date("2026-07-31T00:00:00Z");
    const employees = new Map([
      ["alice", { userId: "user-alice", name: "Alice" }]
    ]);

    const metrics = calculateIssueMetrics(
      [
        {
          state: "open",
          assigneeLogins: ["alice"],
          labels: ["feature", "priority"],
          openedAt: new Date("2026-07-05T00:00:00Z"),
          closedAt: null
        },
        {
          state: "open",
          assigneeLogins: [],
          labels: ["bug"],
          openedAt: new Date("2026-06-01T00:00:00Z"),
          closedAt: null
        },
        {
          state: "closed",
          assigneeLogins: ["alice"],
          labels: ["feature"],
          openedAt: new Date("2026-07-02T00:00:00Z"),
          closedAt: new Date("2026-07-10T00:00:00Z")
        }
      ],
      from,
      to,
      employees
    );

    expect(metrics.totals).toMatchObject({
      open: 2,
      opened: 2,
      closed: 1,
      unassignedOpen: 1,
      overdueOpen: 2,
      avgCycleDays: 8
    });
    expect(metrics.labels[0]).toEqual({ label: "feature", count: 2 });
    expect(metrics.developers[0]).toMatchObject({
      login: "alice",
      employee: { userId: "user-alice", name: "Alice" },
      assignedOpen: 1,
      opened: 2,
      closed: 1
    });
  });

  it("keeps zero-value metrics finite for an empty period", () => {
    const metrics = calculateIssueMetrics(
      [],
      new Date("2026-07-01T00:00:00Z"),
      new Date("2026-07-31T00:00:00Z"),
      new Map()
    );

    expect(metrics.totals).toEqual({
      open: 0,
      opened: 0,
      closed: 0,
      unassignedOpen: 0,
      overdueOpen: 0,
      avgAgeDays: 0,
      avgCycleDays: 0
    });
    expect(metrics.developers).toEqual([]);
  });
});
