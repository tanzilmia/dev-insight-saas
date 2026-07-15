import { z } from "zod";

/** Query for the code-quality overview endpoint. */
export const codeQualityQuerySchema = z.object({
  organizationId: z.string().min(1),
  // The SonarQube project key to read. In the multi-tenant path this will be
  // resolved from a repository→project mapping; for now the caller passes it.
  projectKey: z.string().min(1)
});

export type CodeQualityQuery = z.infer<typeof codeQualityQuerySchema>;
