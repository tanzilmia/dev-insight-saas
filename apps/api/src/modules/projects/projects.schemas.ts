import { z } from "zod";

const organizationId = z.string().min(1);

export const projectRoleSchema = z.enum(["LEAD", "DEVELOPER", "REVIEWER"]);
export const projectStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const listProjectsQuerySchema = z.object({
  organizationId,
  status: projectStatusSchema.optional()
});

export const projectParamsSchema = z.object({
  id: z.string().min(1)
});

export const projectMemberParamsSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1)
});

export const createProjectSchema = z.object({
  organizationId,
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  members: z
    .array(
      z.object({
        userId: z.string().min(1),
        role: projectRoleSchema.default("DEVELOPER")
      })
    )
    .max(50)
    .optional()
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: projectStatusSchema.optional()
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.status !== undefined,
    { message: "Provide at least one field to update" }
  );

export const addProjectMemberSchema = z.object({
  userId: z.string().min(1),
  role: projectRoleSchema.default("DEVELOPER")
});
