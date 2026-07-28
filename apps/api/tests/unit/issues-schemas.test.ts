import { describe, expect, it } from "vitest";

import { issueListQuerySchema, issueMetricsQuerySchema } from "../../src/modules/issues/issues.schemas.js";

describe("GitHub Issues query schemas", () => {
  it("allows metrics queries without the list-only limit field", () => {
    expect(issueMetricsQuerySchema.parse({ organizationId: "org-1" })).toEqual({
      organizationId: "org-1"
    });
  });

  it("requires a complete date range when filtering issues", () => {
    expect(() => issueListQuerySchema.parse({ organizationId: "org-1", from: "2026-07-01" })).toThrow(
      "A date range needs both from and to"
    );
  });
});
