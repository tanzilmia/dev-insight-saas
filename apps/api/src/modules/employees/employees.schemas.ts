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

export const createEmployeeSchema = z.object({
  organizationId,
  name: z.string().trim().min(2).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(120)
    .transform((email) => email.toLowerCase()),
  role: assignableRoleSchema.default("EMPLOYEE")
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
