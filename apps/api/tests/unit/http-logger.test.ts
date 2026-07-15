import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";

import { pinoHttp } from "pino-http";
import { describe, expect, it } from "vitest";

import { HTTP_LOGGER_OPTIONS } from "../../src/common/logging/http-logger.js";

describe("HTTP request logging", () => {
  it("redacts browser and OpenClaw credentials while preserving request metadata", async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      }
    });
    const requestLogger = pinoHttp(HTTP_LOGGER_OPTIONS, destination);
    const server = createServer((req, res) => {
      requestLogger(req, res, () => {
        res.statusCode = 204;
        res.end();
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      await fetch(`http://127.0.0.1:${port}/api/openclaw/tools/context`, {
        headers: {
          authorization: "Bearer jwt-sentinel-secret",
          cookie: "session=cookie-sentinel-secret",
          "x-openclaw-key": "service-key-sentinel-secret",
          "x-openclaw-context": "context-token-sentinel-secret"
        }
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }

    const output = chunks.join("");
    expect(output).toContain("/api/openclaw/tools/context");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("jwt-sentinel-secret");
    expect(output).not.toContain("cookie-sentinel-secret");
    expect(output).not.toContain("service-key-sentinel-secret");
    expect(output).not.toContain("context-token-sentinel-secret");
  });
});
