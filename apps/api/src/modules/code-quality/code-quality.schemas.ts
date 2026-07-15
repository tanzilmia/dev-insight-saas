import { z } from "zod";

/** Query for the code-quality overview endpoint. */
export const codeQualityQuerySchema = z.object({
  organizationId: z.string().min(1),
  // The SonarQube project key to read. In the multi-tenant path this will be
  // resolved from a repository→project mapping; for now the caller passes it.
  projectKey: z.string().min(1)
});

export type CodeQualityQuery = z.infer<typeof codeQualityQuerySchema>;

/** Org-scoped query for connection read / delete / project listing. */
export const codeQualityOrgQuerySchema = z.object({
  organizationId: z.string().min(1)
});

export type CodeQualityOrgQuery = z.infer<typeof codeQualityOrgQuerySchema>;

/** Body to save or test a SonarQube/SonarCloud connection. */
export const codeQualityConnectionSchema = z.object({
  organizationId: z.string().min(1),
  provider: z.enum(["sonarqube", "sonarcloud"]).default("sonarqube"),
  baseUrl: z.string().url(),
  token: z.string().min(1),
  // Required in practice for SonarCloud; optional for self-hosted.
  organizationKey: z.string().trim().min(1).optional()
});

export type CodeQualityConnectionInput = z.infer<typeof codeQualityConnectionSchema>;
