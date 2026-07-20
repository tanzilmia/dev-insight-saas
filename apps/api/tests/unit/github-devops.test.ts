import { afterEach, describe, expect, it, vi } from "vitest";

import { githubDevOpsProvider } from "../../src/modules/github-devops/github-devops.provider.js";

const ref = { owner: "acme", repo: "web" };

function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHubDevOpsProvider", () => {
  it("createBranch treats an already-existing ref (422) as success (idempotent)", async () => {
    stubFetch(422, { message: "Reference already exists" });
    await expect(
      githubDevOpsProvider.createBranch("token", ref, "devinside/ci-setup", "sha1")
    ).resolves.toBeUndefined();
  });

  it("findOpenPullRequestByHead returns the first open PR (dedup guard)", async () => {
    stubFetch(200, [
      {
        number: 7,
        html_url: "https://github.com/acme/web/pull/7",
        state: "open",
        head: { ref: "devinside/ci-setup" }
      }
    ]);
    const pr = await githubDevOpsProvider.findOpenPullRequestByHead("t", ref, "devinside/ci-setup");
    expect(pr).toMatchObject({ number: 7, state: "open", headBranch: "devinside/ci-setup" });
  });

  it("findOpenPullRequestByHead returns null when none are open", async () => {
    stubFetch(200, []);
    expect(await githubDevOpsProvider.findOpenPullRequestByHead("t", ref, "b")).toBeNull();
  });

  it("maps workflow runs to the normalized shape", async () => {
    stubFetch(200, {
      workflow_runs: [
        {
          id: 99,
          workflow_id: 5,
          name: "CI",
          head_branch: "main",
          head_sha: "abc123",
          event: "push",
          status: "completed",
          conclusion: "success",
          actor: { login: "octo" },
          html_url: "https://github.com/acme/web/actions/runs/99",
          run_started_at: "2026-07-15T10:00:00Z",
          updated_at: "2026-07-15T10:03:00Z"
        }
      ]
    });
    const [run] = await githubDevOpsProvider.listWorkflowRuns("t", ref);
    expect(run).toMatchObject({
      runId: "99",
      workflowId: "5",
      name: "CI",
      branch: "main",
      conclusion: "success",
      actor: "octo",
      startedAt: "2026-07-15T10:00:00Z",
      completedAt: "2026-07-15T10:03:00Z"
    });
  });

  it("maps workflow jobs and their steps", async () => {
    stubFetch(200, {
      jobs: [
        {
          id: 77,
          run_id: 99,
          name: "code_quality",
          status: "completed",
          conclusion: "failure",
          steps: [{ name: "SonarQube Scan", status: "completed", conclusion: "failure" }]
        }
      ]
    });
    await expect(githubDevOpsProvider.listWorkflowJobs("t", ref, "99")).resolves.toEqual([
      {
        jobId: "77",
        runId: "99",
        name: "code_quality",
        status: "completed",
        conclusion: "failure",
        steps: [{ name: "SonarQube Scan", status: "completed", conclusion: "failure" }]
      }
    ]);
  });

  it("reads a workflow job log and triggers failed-job reruns", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(new Response("REFUSED_STREAM", { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", mock);

    await expect(githubDevOpsProvider.getWorkflowJobLog("t", ref, "77")).resolves.toBe(
      "REFUSED_STREAM"
    );
    await expect(githubDevOpsProvider.rerunFailedJobs("t", ref, "99")).resolves.toBeUndefined();
    expect(mock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/acme/web/actions/runs/99/rerun-failed-jobs",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("getFile decodes base64 content, and returns null on 404", async () => {
    stubFetch(200, {
      content: Buffer.from("hello world").toString("base64"),
      encoding: "base64",
      sha: "s1",
      path: "package.json"
    });
    expect(await githubDevOpsProvider.getFile("t", ref, "package.json")).toMatchObject({
      content: "hello world",
      sha: "s1"
    });

    stubFetch(404, { message: "Not Found" });
    expect(await githubDevOpsProvider.getFile("t", ref, "missing.txt")).toBeNull();
  });

  it("surfaces a 403 on write as an actionable permission error", async () => {
    stubFetch(403, { message: "Resource not accessible by integration" });
    await expect(
      githubDevOpsProvider.putFile("t", ref, {
        path: ".github/workflows/devinside-ci.yml",
        content: "name: CI",
        message: "ci",
        branch: "devinside/ci-setup"
      })
    ).rejects.toThrow(/Workflows write permission|write permission/i);
  });

  it("mergePullRequest merges and returns the commit sha", async () => {
    stubFetch(200, { merged: true, sha: "mergesha123" });
    expect(await githubDevOpsProvider.mergePullRequest("t", ref, 1)).toEqual({
      merged: true,
      sha: "mergesha123"
    });
  });

  it("mergePullRequest surfaces a not-mergeable PR (405) clearly", async () => {
    stubFetch(405, { message: "Pull Request is not mergeable" });
    await expect(githubDevOpsProvider.mergePullRequest("t", ref, 1)).rejects.toThrow(
      /couldn't merge/i
    );
  });
});
