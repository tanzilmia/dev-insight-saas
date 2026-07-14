import { createHmac, generateKeyPairSync } from "node:crypto";

import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";

// A throwaway RSA keypair for the App. Must be set on process.env BEFORE the
// module under test (which reads config/env.ts at load) is imported — hence the
// dynamic import below, since static imports are hoisted above assignments.
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

process.env.GITHUB_APP_ID = "123456";
process.env.GITHUB_APP_SLUG = "devinside-test";
process.env.GITHUB_APP_PRIVATE_KEY = Buffer.from(privateKey).toString("base64");
process.env.GITHUB_APP_WEBHOOK_SECRET = "test-webhook-secret";
process.env.GITHUB_API_BASE_URL = "https://api.github.test";

const {
  GitHubAppClient,
  generateAppJwt,
  getAppInstallUrl,
  isGitHubAppConfigured,
  isGitHubAppWebhookConfigured,
  normalizePrivateKey,
  verifyWebhookSignature
} = await import("../../src/modules/github-app/github-app.auth.js");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("configuration flags", () => {
  it("reports the App and webhook as configured when env is set", () => {
    expect(isGitHubAppConfigured()).toBe(true);
    expect(isGitHubAppWebhookConfigured()).toBe(true);
  });
});

describe("normalizePrivateKey", () => {
  it("passes a raw PEM through unchanged (trimmed)", () => {
    expect(normalizePrivateKey(privateKey)).toContain("-----BEGIN");
  });

  it("base64-decodes an encoded PEM", () => {
    const encoded = Buffer.from(privateKey).toString("base64");
    expect(normalizePrivateKey(encoded).trim()).toBe(privateKey.trim());
  });
});

describe("generateAppJwt", () => {
  it("signs an RS256 JWT with the App id as issuer and a <=10 min window", () => {
    const token = generateAppJwt();
    const decoded = jwt.decode(token, { complete: true }) as {
      header: { alg: string };
      payload: { iss: string; iat: number; exp: number };
    };
    expect(decoded.header.alg).toBe("RS256");
    expect(decoded.payload.iss).toBe("123456");
    const lifetime = decoded.payload.exp - decoded.payload.iat;
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(10 * 60);
  });

  it("produces a signature verifiable with the public key", () => {
    const token = generateAppJwt();
    expect(() => jwt.verify(token, publicKey, { algorithms: ["RS256"] })).not.toThrow();
  });
});

describe("getAppInstallUrl", () => {
  it("builds the install URL from the App slug", () => {
    expect(getAppInstallUrl()).toBe(
      "https://github.com/apps/devinside-test/installations/new"
    );
  });

  it("appends an opaque state when given", () => {
    expect(getAppInstallUrl("org_123")).toBe(
      "https://github.com/apps/devinside-test/installations/new?state=org_123"
    );
  });
});

describe("verifyWebhookSignature", () => {
  const body = Buffer.from(JSON.stringify({ action: "created" }));
  const validHeader = () =>
    "sha256=" + createHmac("sha256", "test-webhook-secret").update(body).digest("hex");

  it("accepts a correct signature", () => {
    expect(verifyWebhookSignature(body, validHeader())).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(Buffer.from("tampered"), validHeader())).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyWebhookSignature(body, undefined)).toBe(false);
    expect(verifyWebhookSignature(body, "not-a-signature")).toBe(false);
    expect(verifyWebhookSignature(body, "sha1=abc")).toBe(false);
  });
});

describe("GitHubAppClient (mocked fetch)", () => {
  function stubFetch(handler: (url: string, init: RequestInit | undefined) => unknown) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      return new Response(JSON.stringify(handler(url, init)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("mints an installation access token via POST with an App-JWT bearer", async () => {
    const fetchMock = stubFetch(() => ({
      token: "ghs_installationtoken",
      expires_at: "2026-07-14T13:00:00Z",
      repository_selection: "selected"
    }));

    const result = await new GitHubAppClient().createInstallationAccessToken("789");

    expect(result.token).toBe("ghs_installationtoken");
    expect(result.repositorySelection).toBe("selected");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.test/app/installations/789/access_tokens");
    expect(init?.method).toBe("POST");
    const auth = (init?.headers as Record<string, string>).Authorization;
    expect(auth.startsWith("Bearer ")).toBe(true);
    // The bearer must be the App JWT (iss = App id), never a stored secret.
    const decoded = jwt.decode(auth.slice("Bearer ".length)) as { iss: string };
    expect(decoded.iss).toBe("123456");
  });

  it("maps installation metadata", async () => {
    stubFetch(() => ({
      id: 789,
      account: { login: "acme-inc", id: 42, type: "Organization" },
      target_type: "Organization",
      repository_selection: "all",
      suspended_at: null
    }));

    const installation = await new GitHubAppClient().getInstallation("789");
    expect(installation).toMatchObject({
      installationId: "789",
      accountLogin: "acme-inc",
      accountType: "Organization",
      repositorySelection: "all"
    });
  });

  it("maps installation repositories to the shared GitRepository shape", async () => {
    stubFetch(() => ({
      total_count: 1,
      repositories: [
        {
          id: 111,
          name: "web",
          full_name: "acme-inc/web",
          private: true,
          html_url: "https://github.com/acme-inc/web",
          default_branch: "main",
          owner: { login: "acme-inc" }
        }
      ]
    }));

    const repos = await new GitHubAppClient().listInstallationRepositories("ghs_token");
    expect(repos).toEqual([
      {
        externalId: "111",
        owner: "acme-inc",
        name: "web",
        fullName: "acme-inc/web",
        remoteUrl: "https://github.com/acme-inc/web",
        isPrivate: true,
        defaultBranch: "main"
      }
    ]);
  });
});
