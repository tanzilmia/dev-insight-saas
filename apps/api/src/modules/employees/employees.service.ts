import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import type { EmployeeGitAlias, OrganizationMember, Prisma, User } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";
import { autoLinkAlias } from "../contributors/auto-link.js";

type CreateEmployeeInput = {
  organizationId: string;
  name: string;
  email: string;
  role: "EMPLOYEE" | "MANAGER" | "ADMIN";
  gitUsernames?: string[];
};

type UpdateEmployeeInput = {
  organizationId: string;
  name?: string;
  role?: "EMPLOYEE" | "MANAGER" | "ADMIN";
  status?: "ACTIVE" | "DISABLED";
};

type MembershipWithUser = OrganizationMember & { user: User };

/** Normalizes a git username: strip a leading "@", trim, lowercase. */
function normalizeUsername(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function toAlias(alias: EmployeeGitAlias) {
  return {
    id: alias.id,
    username: alias.username,
    email: alias.email,
    name: alias.name,
    isPrimary: alias.isPrimary
  };
}

function toEmployee(membership: MembershipWithUser, aliases: EmployeeGitAlias[] = []) {
  return {
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    status: membership.status,
    joinedAt: membership.createdAt,
    gitAliases: aliases.map(toAlias)
  };
}

async function listAliases(organizationId: string, userId: string) {
  return prisma.employeeGitAlias.findMany({
    where: { organizationId, userId },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
  });
}

/**
 * Creates a declared git alias for an employee inside a transaction and
 * retro-links any matching contributor identities already in the org. Idempotent
 * for the same (org, username, user); throws if another employee owns it.
 */
async function createAlias(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    userId: string;
    username: string;
    isPrimary: boolean;
    actorId: string;
  }
) {
  const username = normalizeUsername(params.username);
  if (!username) {
    return;
  }

  const existing = await tx.employeeGitAlias.findFirst({
    where: { organizationId: params.organizationId, provider: "GITHUB", username }
  });

  if (existing) {
    if (existing.userId !== params.userId) {
      throw new AppError(
        409,
        `The GitHub username "${username}" is already linked to another employee`,
        "GIT_ALIAS_TAKEN"
      );
    }
    return; // already owned by this employee — nothing to do
  }

  const alias = await tx.employeeGitAlias.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      provider: "GITHUB",
      username,
      isPrimary: params.isPrimary
    }
  });

  const autoLinked = await autoLinkAlias(tx, {
    organizationId: params.organizationId,
    userId: params.userId,
    provider: "GITHUB",
    username,
    isPrimary: params.isPrimary
  });

  await tx.auditLog.create({
    data: {
      organizationId: params.organizationId,
      actorId: params.actorId,
      action: "employee.git-alias.add",
      entityType: "EmployeeGitAlias",
      entityId: alias.id,
      metadataJson: { userId: params.userId, username, autoLinked }
    }
  });
}

export async function listEmployees(actorId: string, organizationId: string) {
  await requireOrganizationMember(actorId, organizationId);

  const memberships = await prisma.organizationMember.findMany({
    where: { organizationId },
    include: {
      user: {
        include: {
          gitAliases: {
            where: { organizationId },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
          }
        }
      }
    },
    orderBy: { createdAt: "asc" }
  });

  return memberships.map((membership) => toEmployee(membership, membership.user.gitAliases));
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

  const [aliases, projectMemberships] = await Promise.all([
    listAliases(organizationId, userId),
    prisma.projectMember.findMany({
      where: {
        userId,
        project: { organizationId }
      },
      include: { project: true },
      orderBy: { createdAt: "asc" }
    })
  ]);

  return {
    ...toEmployee(membership, aliases),
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

  // De-duplicate the submitted usernames; the first one becomes the primary
  // identity (used as the canonical author in reports).
  const usernames = [
    ...new Set((input.gitUsernames ?? []).map(normalizeUsername).filter(Boolean))
  ];

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
          reusedExistingUser: Boolean(existingUser),
          gitUsernames: usernames.length
        }
      }
    });

    for (let index = 0; index < usernames.length; index += 1) {
      await createAlias(tx, {
        organizationId: input.organizationId,
        userId: user.id,
        username: usernames[index],
        isPrimary: index === 0,
        actorId
      });
    }

    return created;
  });

  const aliases = await listAliases(input.organizationId, membership.userId);
  return toEmployee(membership, aliases);
}

type BulkEmployeeRow = {
  name: string;
  email: string;
  role?: "EMPLOYEE" | "MANAGER" | "ADMIN";
  gitUsernames?: string[];
};

type BulkCreateInput = {
  organizationId: string;
  employees: BulkEmployeeRow[];
};

export type BulkEmployeeResult = {
  email: string;
  status: "created" | "skipped" | "failed";
  message?: string;
};

/**
 * Bulk-adds employees from a parsed CSV. Each row is created independently with
 * per-row error capture, so a duplicate or a bad row never aborts the whole
 * import — an already-a-member row is reported as "skipped", a genuinely bad row
 * as "failed" (with the reason). Reuses {@link addEmployee} per row so alias
 * auto-linking, audit logging, and validation all apply exactly as for a single add.
 */
export async function addEmployeesBulk(actorId: string, input: BulkCreateInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  const results: BulkEmployeeResult[] = [];
  let created = 0;

  for (const row of input.employees) {
    try {
      await addEmployee(actorId, {
        organizationId: input.organizationId,
        name: row.name,
        email: row.email,
        role: row.role ?? "EMPLOYEE",
        gitUsernames: row.gitUsernames
      });
      created += 1;
      results.push({ email: row.email, status: "created" });
    } catch (error) {
      const isAppError = error instanceof AppError;
      const status: BulkEmployeeResult["status"] =
        isAppError && error.code === "EMPLOYEE_EXISTS" ? "skipped" : "failed";
      results.push({
        email: row.email,
        status,
        message: isAppError ? error.message : "Could not add this employee"
      });
    }
  }

  return { created, total: input.employees.length, results };
}

export async function addEmployeeGitAlias(
  actorId: string,
  userId: string,
  input: { organizationId: string; username: string; isPrimary?: boolean }
) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId: input.organizationId, userId }
  });

  if (!membership) {
    throw new AppError(404, "Employee was not found in this organization", "EMPLOYEE_NOT_FOUND");
  }

  await prisma.$transaction(async (tx) => {
    const aliasCount = await tx.employeeGitAlias.count({
      where: { organizationId: input.organizationId, userId }
    });

    await createAlias(tx, {
      organizationId: input.organizationId,
      userId,
      username: input.username,
      // The employee's first alias is primary by default.
      isPrimary: input.isPrimary ?? aliasCount === 0,
      actorId
    });
  });

  return getEmployee(actorId, input.organizationId, userId);
}

export async function removeEmployeeGitAlias(
  actorId: string,
  organizationId: string,
  userId: string,
  aliasId: string
) {
  await requireOrganizationRole(actorId, organizationId, MANAGER_ROLES);

  const alias = await prisma.employeeGitAlias.findFirst({
    where: { id: aliasId, organizationId, userId }
  });

  if (!alias) {
    throw new AppError(404, "Git identity was not found", "GIT_ALIAS_NOT_FOUND");
  }

  // Removing a declared identity stops *future* auto-linking. Existing
  // contributor mappings are left intact (they may have been confirmed manually
  // and could still be correct); unmap those explicitly from the contributors
  // view if needed.
  await prisma.$transaction(async (tx) => {
    await tx.employeeGitAlias.delete({ where: { id: aliasId } });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId,
        action: "employee.git-alias.remove",
        entityType: "EmployeeGitAlias",
        entityId: aliasId,
        metadataJson: { userId, username: alias.username }
      }
    });
  });

  return getEmployee(actorId, organizationId, userId);
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

  const aliases = await listAliases(input.organizationId, userId);
  return toEmployee(updated, aliases);
}
