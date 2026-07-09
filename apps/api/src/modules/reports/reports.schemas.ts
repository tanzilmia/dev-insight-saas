import { z } from "zod";

import { reportTypeSchema } from "../openclaw/openclaw.schemas.js";

export const listReportsQuerySchema = z.object({
  organizationId: z.string().min(1),
  reportType: reportTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export const reportParamsSchema = z.object({
  id: z.string().min(1)
});
