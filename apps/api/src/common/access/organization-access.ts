import type { OrgRole } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../errors/app-error.js";

/**
 * Roles allowed to manage organization resources such as projects and
 * employees. Employees have read-only access to these areas.
 */
export const MANAGER_ROLES: OrgRole[] = ["OWNER", "MANAGER", "ADMIN"];

export async function getActiveMembership(userId: string, organizationId: string) {
  return prisma.organizationMember.findFirst({
    where: {
      userId,
      organizationId,
      status: "ACTIVE"
    }
  });
}

/**
 * Ensures the user is an active member of the organization. Throws otherwise.
 * Returns the membership so callers can inspect the role.
 */
export async function requireOrganizationMember(userId: string, organizationId: string) {
  const membership = await getActiveMembership(userId, organizationId);

  if (!membership) {
    throw new AppError(403, "You do not have access to this organization", "ORG_ACCESS_DENIED");
  }

  return membership;
}

/**
 * Ensures the user is an active member with one of the allowed roles.
 */
export async function requireOrganizationRole(
  userId: string,
  organizationId: string,
  roles: OrgRole[]
) {
  const membership = await requireOrganizationMember(userId, organizationId);

  if (!roles.includes(membership.role)) {
    throw new AppError(
      403,
      "You do not have permission to perform this action",
      "INSUFFICIENT_ROLE"
    );
  }

  return membership;
}
