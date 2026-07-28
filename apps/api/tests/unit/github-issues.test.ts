import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubProvider } from "../../src/modules/github/github.provider.js";

const ref = { owner: "acme", repo: "devinside" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubProvider issues", () => {
  it("maps issues, excludes pull requests, and maps timeline events", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 101,
              number: 42,
              title: "Track GitHub issues",
              body: "Work item",
              state: "open",
              state_reason: null,
              user: { login: "Tanzil", avatar_url: "https://avatar" },
              assignees: [{ login: "Alice" }],
              labels: [{ name: "feature" }],
              milestone: { title: "MVP" },
              html_url: "https://github.com/acme/devinside/issues/42",
              created_at: "2026-07-20T10:00:00Z",
              updated_at: "2026-07-21T10:00:00Z",
              closed_at: null
            },
            {
              id: 102,
              number: 43,
              title: "A pull request",
              pull_request: { url: "https://api.github.com/pulls/43" },
              created_at: "2026-07-20T10:00:00Z",
              updated_at: "2026-07-20T10:00:00Z"
            }
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 9001,
              event: "assigned",
              actor: { login: "manager" },
              assignee: { login: "Alice" },
              created_at: "2026-07-20T11:00:00Z"
            }
          ]),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GitHubProvider();
    const issues = await provider.listIssues("token", ref.owner, ref.repo);
    const events = await provider.listIssueEvents("token", ref.owner, ref.repo, 42);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      externalId: "101",
      number: 42,
      authorLogin: "Tanzil",
      assigneeLogins: ["alice"],
      labels: ["feature"]
    });
    expect(events[0]).toMatchObject({
      externalId: "9001",
      eventType: "assigned",
      actorLogin: "manager",
      assigneeLogin: "alice"
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/repos/acme/devinside/issues?");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/issues/42/events?");
  });

  it("surfaces provider failures clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "bad gateway" }), { status: 502 }))
    );

    await expect(new GitHubProvider().listIssues("token", ref.owner, ref.repo)).rejects.toThrow(
      /GitHub API request failed/
    );
  });
});
