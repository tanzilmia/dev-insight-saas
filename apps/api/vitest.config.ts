import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * NodeNext ESM writes explicit `.js` extensions in imports even for `.ts`
 * sources (see CLAUDE.md). Vite/Vitest does not map `.js` → `.ts` on its own,
 * so this pre-resolver bridges relative `.js` specifiers to the real `.ts`
 * files. It only touches relative imports; bare/node_modules specifiers and
 * genuinely-`.js` files fall through untouched.
 */
const resolveTsFromJs = {
  name: "resolve-ts-from-js",
  enforce: "pre" as const,
  resolveId(source: string, importer: string | undefined) {
    if (!importer) return null;
    if (!source.endsWith(".js")) return null;
    if (!source.startsWith("./") && !source.startsWith("../")) return null;
    const candidate = resolve(dirname(importer), `${source.slice(0, -3)}.ts`);
    return existsSync(candidate) ? candidate : null;
  }
};

export default defineConfig({
  plugins: [resolveTsFromJs],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Coverage for SonarQube: `vitest run --coverage` writes lcov to ./coverage,
    // which sonar-project.properties points at. Only src is measured; the tests
    // themselves and generated/boot files are excluded so the % reflects real
    // product code.
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/main.ts"]
    },
    // Hermetic env so importing config/env.ts (Zod-validated at load) never
    // depends on a developer's .env. None of these are real; the unit suite
    // never opens a DB connection or calls an external service.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/devinsight_test",
      JWT_ACCESS_SECRET: "test-jwt-access-secret-not-for-production-use",
      // Valid base64-encoded 32-byte key (== "0123456789abcdef0123456789abcdef").
      GIT_TOKEN_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    }
  }
});
