import { z } from "zod";

const organizationId = z.string().min(1);

/** Roles that can be assigned when adding/updating an employee (never OWNER). */
export const assignableRoleSchema = z.enum(["EMPLOYEE", "MANAGER", "ADMIN"]);

export const listEmployeesQuerySchema = z.object({
  organizationId
});

export const employeeParamsSchema = z.object({
  userId: z.string().min(1)
});

/** A single git username/handle (a leading "@" is allowed and stripped later). */
const gitUsername = z.string().trim().min(1).max(80);

export const createEmployeeSchema = z.object({
  organizationId,
  name: z.string().trim().min(2).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(120)
    .transform((email) => email.toLowerCase()),
  role: assignableRoleSchema.default("EMPLOYEE"),
  gitUsernames: z.array(gitUsername).max(20).optional()
});

/** A single row of the bulk CSV import. `role` defaults to EMPLOYEE downstream. */
const bulkEmployeeRowSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(120)
    .transform((email) => email.toLowerCase()),
  role: assignableRoleSchema.optional(),
  gitUsernames: z.array(gitUsername).max(20).optional()
});

export const bulkCreateEmployeesSchema = z.object({
  organizationId,
  employees: z.array(bulkEmployeeRowSchema).min(1).max(500)
});

export const gitAliasParamsSchema = z.object({
  userId: z.string().min(1),
  aliasId: z.string().min(1)
});

export const addGitAliasSchema = z.object({
  organizationId,
  username: gitUsername,
  isPrimary: z.boolean().optional()
});

export const removeGitAliasQuerySchema = z.object({
  organizationId
});

export const updateEmployeeSchema = z
  .object({
    organizationId,
    name: z.string().trim().min(2).max(80).optional(),
    role: assignableRoleSchema.optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional()
  })
  .refine(
    (value) =>
      value.name !== undefined || value.role !== undefined || value.status !== undefined,
    { message: "Provide at least one field to update" }
  );
