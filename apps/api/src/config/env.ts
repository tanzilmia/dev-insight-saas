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
  OPENCLAW_GATEWAY_TOKEN: z.string().optional()
});

export const env = envSchema.parse(process.env);

