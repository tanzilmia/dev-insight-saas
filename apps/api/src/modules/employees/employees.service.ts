import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import type { OrganizationMember, User } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";

type CreateEmployeeInput = {
  organizationId: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "MANAGER" | "ADMIN";
};

type UpdateEmployeeInput = {
  organizationId: string;
  name?: string;
  role?: "EMPLOYEE" | "MANAGER" | "ADMIN";
  status?: "ACTIVE" | "DISABLED";
};

type MembershipWithUser = OrganizationMember & { user: User };

function toEmployee(membership: MembershipWithUser) {
  return {
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.createdAt
  };
}

export async function listEmployees(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);

  const memberships = await prisma.organizationMember.findMany({
    where: { organizationId },
    include: { user: true },
    orderBy: { createdAt: "asc" }
  });

  return memberships.map(toEmployee);
}

export async function getEmployee(
  actorId: string,
  organizationId: string,
  userId: string
) {
  await requireOrganizationMember(actorId, organizationId);

  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId, userId },
    include: { user: true }
  });

  if (!membership) {
    throw new AppError(404, "Employee was not found in this organization", "EMPLOYEE_NOT_FOUND");
  }

  const projectMemberships = await prisma.projectMember.findMany({
    where: {
      userId,
      project: { organizationId }
    },
    include: { project: true },
    orderBy: { createdAt: "asc" }
  });

  return {
    ...toEmployee(membership),
    projects: projectMemberships.map((projectMember) => ({
      id: projectMember.project.id,
      name: projectMember.project.name,
      status: projectMember.project.status,
      role: projectMember.role
    }))
  };
}

export async function addEmployee(actorId: string, input: CreateEmployeeInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (existingUser) {
    const existingMembership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: input.organizationId,
          userId: existingUser.id
        }
      }
    });

    if (existingMembership) {
      throw new AppError(409, "This person is already part of the organization", "EMPLOYEE_EXISTS");
    }
  }

  // Employees are created without a usable password. A dedicated invite/reset
  // flow (a later phase) will let them set one and log in.
  const passwordHash = existingUser
    ? existingUser.passwordHash
    : await bcrypt.hash(randomBytes(24).toString("hex"), 12);

  const membership = await prisma.$transaction(async (tx) => {
    const user =
      existingUser ??
      (await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash
        }
      }));

    const created = await tx.organizationMember.create({
      data: {
        organizationId: input.organizationId,
        userId: user.id,
        role: input.role,
        status: "ACTIVE"
      },
      include: { user: true }
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId,
        action: "employee.add",
        entityType: "OrganizationMember",
        entityId: created.id,
        metadataJson: {
          userId: user.id,
          role: input.role,
          reusedExistingUser: Boolean(existingUser)
        }
      }
    });

    return created;
  });

  return toEmployee(membership);
}

export async function updateEmployee(
  actorId: string,
  userId: string,
  input: UpdateEmployeeInput
) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId: input.organizationId, userId },
    include: { user: true }
  });

  if (!membership) {
    throw new AppError(404, "Employee was not found in this organization", "EMPLOYEE_NOT_FOUND");
  }

  if (membership.role === "OWNER") {
    throw new AppError(403, "The organization owner cannot be modified", "OWNER_IMMUTABLE");
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (input.name !== undefined) {
      await tx.user.update({
        where: { id: userId },
        data: { name: input.name }
      });
    }

    const member = await tx.organizationMember.update({
      where: { id: membership.id },
      data: {
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      },
      include: { user: true }
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId,
        action: "employee.update",
        entityType: "OrganizationMember",
        entityId: membership.id,
        metadataJson: {
          userId,
          role: input.role ?? null,
          status: input.status ?? null,
          nameChanged: input.name !== undefined
        }
      }
    });

    return member;
  });

  return toEmployee(updated);
}
