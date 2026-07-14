import { describe, expect, it } from "vitest";

import {
  hasGitAccess,
  resolveRepositoryToken
} from "../../src/modules/github-app/repository-token.js";

describe("hasGitAccess", () => {
  it("is true when a PAT credential is present", () => {
    expect(hasGitAccess({ credentialId: "cred_1", appInstallationId: null })).toBe(true);
  });

  it("is true when a GitHub App installation is present", () => {
    expect(hasGitAccess({ credentialId: null, appInstallationId: "inst_1" })).toBe(true);
  });

  it("is false when the repository has neither source", () => {
    expect(hasGitAccess({ credentialId: null, appInstallationId: null })).toBe(false);
  });
});

describe("resolveRepositoryToken", () => {
  it("throws NO_CREDENTIAL (no IO) when the repository has neither a PAT nor an App", async () => {
    // Both sources null → returns before touching Prisma or GitHub.
    await expect(
      resolveRepositoryToken({
        credentialId: null,
        appInstallationId: null,
        provider: "GITHUB"
      })
    ).rejects.toThrow(/no GitHub access/i);
  });
});
