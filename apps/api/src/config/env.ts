import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(24),
  GIT_TOKEN_ENCRYPTION_KEY: z.string().min(1)
});

export const env = envSchema.parse(process.env);

