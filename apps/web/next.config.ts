import type { NextConfig } from "next";
import path from "node:path";

// Standalone output is enabled ONLY for the Docker/production image, which sets
// NEXT_OUTPUT=standalone (see apps/web/Dockerfile). Local `next dev` / `next build`
// see an empty config, so local behaviour is unchanged.
//
// In this npm-workspaces monorepo the tracing root must be the repo root so the
// standalone bundle picks up the hoisted node_modules; the server entry then
// lands at apps/web/server.js.
const isStandalone = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = isStandalone
  ? {
      output: "standalone",
      outputFileTracingRoot: path.join(__dirname, "../../"),
    }
  : {};

export default nextConfig;
