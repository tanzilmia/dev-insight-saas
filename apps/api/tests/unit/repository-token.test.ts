import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findInstallation: vi.fn(),
  createInstallationAccessToken: vi.fn(),
  provider: { getUser: vi.fn() }
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    gitHubAppInstallation: { findFirst: mocks.findInstallation }
  }
}));

vi.mock("../../src/modules/github-app/github-app.auth.js", () => ({
  githubAppClient: {
    createInstallationAccessToken: mocks.createInstallationAccessToken
  }
}));

vi.mock("../../src/modules/git-providers/provider-registry.js", () => ({
  getGitProvider: () => mocks.provider
}));

import {
  hasGitAccess,
  resolveRepositoryToken
} from "../../src/modules/github-app/repository-token.js";

describe("GitHub App repository access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires an App installation link", () => {
    expect(hasGitAccess({ appInstallationId: "inst_1" })).toBe(true);
    expect(hasGitAccess({ appInstallationId: null })).toBe(false);
  });

  it("mints a short-lived token only after matching the repository grant", async () => {
    mocks.findInstallation.mockResolvedValue({ installationId: "9001" });
    mocks.createInstallationAccessToken.mockResolvedValue({ token: "ghs_short_lived" });

    const access = await resolveRepositoryToken({
      id: "repo_1",
      organizationId: "org_1",
      appInstallationId: "inst_1",
      provider: "GITHUB"
    });

    expect(mocks.findInstallation).toHaveBeenCalledWith({
      where: {
        id: "inst_1",
        organizationId: "org_1",
        suspendedAt: null,
        access: { some: { repositoryId: "repo_1" } }
      }
    });
    expect(mocks.createInstallationAccessToken).toHaveBeenCalledWith("9001");
    expect(access).toEqual({ token: "ghs_short_lived", provider: mocks.provider });
  });

  it("rejects a repository without an active App grant", async () => {
    mocks.findInstallation.mockResolvedValue(null);

    await expect(
      resolveRepositoryToken({
        id: "repo_1",
        organizationId: "org_1",
        appInstallationId: "inst_1",
        provider: "GITHUB"
      })
    ).rejects.toMatchObject({ code: "GITHUB_APP_ACCESS_REQUIRED", statusCode: 400 });
    expect(mocks.createInstallationAccessToken).not.toHaveBeenCalled();
  });
});
