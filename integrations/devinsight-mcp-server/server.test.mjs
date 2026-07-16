import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createMcpApp, readConfig, requireMcpBearer } from "./server.mjs";

const VALID_CONFIG = {
  devInsightUrl: "http://127.0.0.1:4000",
  serviceKey: "service-test-secret",
  mcpAccessToken: "mcp-test-secret",
  host: "127.0.0.1",
  port: 0
};

test("configuration fails closed when either machine credential is missing", () => {
  assert.throws(
    () => readConfig({ MCP_ACCESS_TOKEN: "mcp" }),
    /DEVINSIGHT_SERVICE_KEY is required/
  );
  assert.throws(
    () => readConfig({ DEVINSIGHT_SERVICE_KEY: "service" }),
    /MCP_ACCESS_TOKEN is required/
  );
});

test("configuration defaults to the loopback interface", () => {
  const config = readConfig({
    DEVINSIGHT_SERVICE_KEY: "service",
    MCP_ACCESS_TOKEN: "mcp"
  });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 4100);
});

test("bearer middleware uses fail-closed authorization", () => {
  const authenticate = requireMcpBearer("expected-secret");
  const calls = [];
  const response = {
    status(code) {
      calls.push(["status", code]);
      return this;
    },
    json(body) {
      calls.push(["json", body]);
    }
  };
  let passed = false;

  authenticate({ header: () => "Bearer wrong-secret" }, response, () => {
    passed = true;
  });

  assert.equal(passed, false);
  assert.deepEqual(calls, [
    ["status", 401],
    ["json", { error: "Unauthorized" }]
  ]);
});

test("the HTTP MCP route rejects requests before parsing without a bearer", async () => {
  const server = createMcpApp(VALID_CONFIG).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json"
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("health response reveals no tenant identity", async () => {
  const server = createMcpApp(VALID_CONFIG).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    server.close();
    await once(server, "close");
  }
});
