import { z } from "zod";

const organizationId = z.string().min(1);

export const orgQuerySchema = z.object({
  organizationId
});

export const repositoryParamsSchema = z.object({
  id: z.string().min(1)
});

export const assignRepositoryProjectSchema = z.object({
  projectId: z.string().min(1).nullable()
});

export const setSonarProjectKeySchema = z.object({
  sonarProjectKey: z.string().trim().max(400).nullable()
});
