import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(24),
  GIT_TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.from(value, "base64").length === 32,
      "GIT_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key"
    ),
  // Overridable so tests can point the GitHub provider at a mock server.
  GITHUB_API_BASE_URL: z.string().url().default("https://api.github.com"),
  // Externally reachable base URL of THIS API — where GitHub delivers webhooks.
  // Optional: live sync stays unavailable (with a UI hint) until it is set.
  PUBLIC_API_URL: z.string().url().optional(),
  // LLM (OpenAI-compatible). Key is optional — reports fall back to a template
  // when it is absent. Base URL is overridable so tests can use a mock server.
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  // OpenClaw integration (all optional — features degrade gracefully when unset).
  // Service key: the shared secret the OpenClaw plugin uses to call our tool
  // endpoints. Gateway URL/token: how OUR backend reaches the OpenClaw runtime
  // for the website chat proxy (kept server-side; never exposed to the browser).
  OPENCLAW_SERVICE_KEY: z.string().optional(),
  OPENCLAW_GATEWAY_URL: z.string().url().optional(),
  OPENCLAW_GATEWAY_TOKEN: z.string().optional(),
  // Used only by this API to mint short-lived, tenant-scoped tool context.
  // Never share it with OpenClaw or the MCP bridge.
  OPENCLAW_CONTEXT_SIGNING_SECRET: z.string().min(32).optional(),
  // GitHub App (customer repository connection). All optional: App features stay
  // unavailable (with a clear UI hint) until the DevInside owner registers the
  // App and sets these — see docs/architecture/github-app-foundation.md.
  GITHUB_APP_ID: z.string().optional(),
  // The App's URL slug, used to build the install URL github.com/apps/<slug>/…
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_CLIENT_ID: z.string().optional(),
  // The App's RSA private key (PEM). Accepts a base64-encoded PEM (recommended —
  // avoids newline issues in env) or a raw PEM with literal newlines.
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
  // Code-quality provider (SonarQube self-hosted, or SonarCloud with the same
  // Web API). All optional — code-quality features stay unavailable (with a UI
  // hint) until SONAR_TOKEN is set. SONAR_ORGANIZATION is empty for self-hosted
  // and set for SonarCloud; supplying it also enables branch/PR capabilities.
  CODE_QUALITY_PROVIDER: z.enum(["sonarqube"]).default("sonarqube"),
  SONAR_BASE_URL: z.string().url().default("http://localhost:9000"),
  SONAR_TOKEN: z.string().optional(),
  SONAR_ORGANIZATION: z.string().optional(),
  // Externally reachable SonarQube base URL — the one a CLIENT repo's GitHub
  // Actions runner uses to push scan results (over the internet), as opposed to
  // SONAR_BASE_URL which is how THIS API reaches SonarQube (Docker-internal).
  // Optional: multi-tenant auto-scan provisioning stays unavailable (clean 400)
  // until it is set. Prefer an HTTPS URL so the injected analysis token isn't
  // sent in clear text (e.g. https://your-domain/sonarqube).
  SONAR_PUBLIC_URL: z.string().url().optional()
}).superRefine((value, ctx) => {
  const openClawEnabled = Boolean(
    value.OPENCLAW_SERVICE_KEY || value.OPENCLAW_GATEWAY_URL || value.OPENCLAW_GATEWAY_TOKEN
  );

  if (openClawEnabled && !value.OPENCLAW_CONTEXT_SIGNING_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OPENCLAW_CONTEXT_SIGNING_SECRET"],
      message: "OPENCLAW_CONTEXT_SIGNING_SECRET is required when OpenClaw is configured"
    });
  }
});

export const env = envSchema.parse(process.env);
