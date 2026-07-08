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
  GITHUB_API_BASE_URL: z.string().url().default("https://api.github.com")
});

export const env = envSchema.parse(process.env);

