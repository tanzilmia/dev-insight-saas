import { z } from "zod";

export const repositoryBodySchema = z.object({
  repositoryId: z.string().min(1)
});

export const repositoryQuerySchema = z.object({
  repositoryId: z.string().min(1)
});
