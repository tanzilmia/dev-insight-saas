import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120).transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
  organizationName: z.string().trim().min(2).max(100)
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(120).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128)
});

