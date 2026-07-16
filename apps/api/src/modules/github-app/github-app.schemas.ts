import { z } from "zod";

export const organizationQuerySchema = z.object({
  organizationId: z.string().min(1)
});

export const linkInstallationSchema = z.object({
  organizationId: z.string().min(1),
  // GitHub sends installation_id as a number in the redirect; accept both.
  installationId: z.union([z.string().min(1), z.number()]).transform((value) => String(value)),
  setupAction: z.string().max(40).optional()
});

export const syncInstallationSchema = z.object({
  organizationId: z.string().min(1)
});

export const resolveGitHubUserQuerySchema = z.object({
  organizationId: z.string().min(1),
  username: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((value) => value.replace(/^@+/, ""))
});

export type LinkInstallationInput = z.infer<typeof linkInstallationSchema>;
