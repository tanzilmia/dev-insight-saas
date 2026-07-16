import { afterEach, describe, expect, it, vi } from "vitest";

import { SonarQubeProvider } from "../../src/modules/code-quality/sonarqube.provider.js";

const config = {
  baseUrl: "https://sonar.example.com/sonarqube",
  token: "squ_test_user_token",
  organizationKey: null
};

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SonarQubeProvider Web API requests", () => {
  it("uses Bearer authentication for JSON reads", async () => {
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ components: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const provider = new SonarQubeProvider(config);
    await expect(provider.listProjects()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/sonarqube/api/components/search");
    expect(init).toMatchObject({
      headers: { Authorization: `Bearer ${config.token}` }
    });
  });

  it("uses Bearer authentication for provisioning writes", async () => {
    const fetchMock = mockFetch(new Response(null, { status: 204 }));

    const provider = new SonarQubeProvider(config);
    await expect(provider.ensureProject("devinside-acme-web", "acme/web")).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/sonarqube/api/projects/create");
    expect(init).toMatchObject({
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` }
    });
  });

  it("maps an HTML success response to a typed invalid-response error", async () => {
    mockFetch(
      new Response("<!doctype html><title>SonarQube</title>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      })
    );

    const provider = new SonarQubeProvider(config);
    await expect(provider.listProjects()).rejects.toMatchObject({
      statusCode: 502,
      code: "CODE_QUALITY_INVALID_RESPONSE"
    });
  });

  it("maps malformed JSON to the same typed invalid-response error", async () => {
    mockFetch(
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const provider = new SonarQubeProvider(config);
    await expect(provider.listProjects()).rejects.toMatchObject({
      statusCode: 502,
      code: "CODE_QUALITY_INVALID_RESPONSE"
    });
  });
});
