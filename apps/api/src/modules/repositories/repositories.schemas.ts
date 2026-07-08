import { z } from "zod";

const organizationId = z.string().min(1);

export const orgQuerySchema = z.object({
  organizationId
});

export const repositoryParamsSchema = z.object({
  id: z.string().min(1)
});

export const syncRepositoriesSchema = z.object({
  organizationId
});

const repositoryInputSchema = z.object({
  externalId: z.string().min(1),
  owner: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  fullName: z.string().min(1).max(320),
  remoteUrl: z.string().url().max(500),
  isPrivate: z.boolean().default(false),
  defaultBranch: z.string().max(200).nullable().optional()
});

export const selectRepositoriesSchema = z.object({
  organizationId,
  repositories: z.array(repositoryInputSchema).min(1).max(200)
});

export const assignRepositoryProjectSchema = z.object({
  projectId: z.string().min(1).nullable()
});
