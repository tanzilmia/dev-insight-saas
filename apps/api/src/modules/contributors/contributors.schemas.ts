import { z } from "zod";

const repositoryId = z.string().min(1);

export const discoverSchema = z.object({
  repositoryId
});

export const repoQuerySchema = z.object({
  repositoryId
});

export const orgQuerySchema = z.object({
  organizationId: z.string().min(1)
});

export const contributorParamsSchema = z.object({
  id: z.string().min(1)
});

export const mapContributorSchema = z.object({
  userId: z.string().min(1),
  isPrimary: z.boolean().default(false)
});

export const ignoreContributorSchema = z.object({
  ignored: z.boolean()
});
