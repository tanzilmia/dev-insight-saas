import type { Project, ProjectMember, ProjectRole, ProjectStatus, User } from "@prisma/client";

import { prisma } from "../../config/database.js";
import { AppError } from "../../common/errors/app-error.js";
import {
  MANAGER_ROLES,
  requireOrganizationMember,
  requireOrganizationRole
} from "../../common/access/organization-access.js";

type CreateProjectInput = {
  organizationId: string;
  name: string;
  description?: string;
  members?: { userId: string; role: ProjectRole }[];
};

type UpdateProjectInput = {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
};

type AddProjectMemberInput = {
  userId: string;
  role: ProjectRole;
};

type ProjectMemberWithUser = ProjectMember & { user: User };

function toProjectSummary(project: Project, memberCount: number) {
  return {
    id: project.id,
    organizationId: project.organizationId,
    name: project.name,
    description: project.description,
    status: project.status,
    memberCount,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

function toProjectMember(member: ProjectMemberWithUser) {
  return {
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    addedAt: member.createdAt
  };
}

/** Loads a project or throws 404. Used before permission checks on :id routes. */
async function loadProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) {
    throw new AppError(404, "Project was not found", "PROJECT_NOT_FOUND");
  }

  return project;
}

export async function listProjects(
  actorId: string,
  organizationId: string,
  status?: ProjectStatus
) {
  await requireOrganizationMember(actorId, organizationId);

  const projects = await prisma.project.findMany({
    where: {
      organizationId,
      ...(status ? { status } : {})
    },
    include: { _count: { select: { members: true } } },
    orderBy: { createdAt: "desc" }
  });

  return projects.map((project) => toProjectSummary(project, project._count.members));
}

export async function getProject(actorId: string, projectId: string) {
  const project = await loadProject(projectId);
  await requireOrganizationMember(actorId, project.organizationId);

  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: true },
    orderBy: { createdAt: "asc" }
  });

  return {
    ...toProjectSummary(project, members.length),
    members: members.map(toProjectMember)
  };
}

export async function createProject(actorId: string, input: CreateProjectInput) {
  await requireOrganizationRole(actorId, input.organizationId, MANAGER_ROLES);

  // De-duplicate the requested members (last role wins) and confirm each is an
  // active member of the organization before assigning them to the project.
  const memberByUserId = new Map<string, ProjectRole>();
  for (const member of input.members ?? []) {
    memberByUserId.set(member.userId, member.role);
  }
  const memberEntries = [...memberByUserId.entries()];

  if (memberEntries.length > 0) {
    const activeMembers = await prisma.organizationMember.findMany({
      where: {
        organizationId: input.organizationId,
        userId: { in: memberEntries.map(([userId]) => userId) },
        status: "ACTIVE"
      },
      select: { userId: true }
    });
    const activeUserIds = new Set(activeMembers.map((member) => member.userId));
    const invalid = memberEntries.filter(([userId]) => !activeUserIds.has(userId));

    if (invalid.length > 0) {
      throw new AppError(
        400,
        "One or more selected people are not active members of this organization",
        "USER_NOT_IN_ORGANIZATION"
      );
    }
  }

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        description: input.description ?? null
      }
    });

    for (const [userId, role] of memberEntries) {
      await tx.projectMember.create({
        data: { projectId: created.id, userId, role }
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId,
        action: "project.create",
        entityType: "Project",
        entityId: created.id,
        metadataJson: { name: created.name, members: memberEntries.length }
      }
    });

    return created;
  });

  return toProjectSummary(project, memberEntries.length);
}

export async function updateProject(
  actorId: string,
  projectId: string,
  input: UpdateProjectInput
) {
  const project = await loadProject(projectId);
  await requireOrganizationRole(actorId, project.organizationId, MANAGER_ROLES);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.project.update({
      where: { id: projectId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {})
      },
      include: { _count: { select: { members: true } } }
    });

    await tx.auditLog.create({
      data: {
        organizationId: project.organizationId,
        actorId,
        action: "project.update",
        entityType: "Project",
        entityId: projectId,
        metadataJson: {
          name: input.name ?? null,
          status: input.status ?? null,
          descriptionChanged: input.description !== undefined
        }
      }
    });

    return result;
  });

  return toProjectSummary(updated, updated._count.members);
}

export async function deleteProject(actorId: string, projectId: string) {
  const project = await loadProject(projectId);
  await requireOrganizationRole(actorId, project.organizationId, MANAGER_ROLES);

  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id: projectId } });

    await tx.auditLog.create({
      data: {
        organizationId: project.organizationId,
        actorId,
        action: "project.delete",
        entityType: "Project",
        entityId: projectId,
        metadataJson: { name: project.name }
      }
    });
  });

  return { id: projectId };
}

export async function addProjectMember(
  actorId: string,
  projectId: string,
  input: AddProjectMemberInput
) {
  const project = await loadProject(projectId);
  await requireOrganizationRole(actorId, project.organizationId, MANAGER_ROLES);

  const targetMembership = await prisma.organizationMember.findFirst({
    where: {
      organizationId: project.organizationId,
      userId: input.userId,
      status: "ACTIVE"
    }
  });

  if (!targetMembership) {
    throw new AppError(
      400,
      "That person is not an active member of this organization",
      "USER_NOT_IN_ORGANIZATION"
    );
  }

  const member = await prisma.$transaction(async (tx) => {
    const upserted = await tx.projectMember.upsert({
      where: {
        projectId_userId: { projectId, userId: input.userId }
      },
      create: {
        projectId,
        userId: input.userId,
        role: input.role
      },
      update: { role: input.role },
      include: { user: true }
    });

    await tx.auditLog.create({
      data: {
        organizationId: project.organizationId,
        actorId,
        action: "project.member.add",
        entityType: "ProjectMember",
        entityId: upserted.id,
        metadataJson: { projectId, userId: input.userId, role: input.role }
      }
    });

    return upserted;
  });

  return toProjectMember(member);
}

export async function removeProjectMember(
  actorId: string,
  projectId: string,
  userId: string
) {
  const project = await loadProject(projectId);
  await requireOrganizationRole(actorId, project.organizationId, MANAGER_ROLES);

  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } }
  });

  if (!existing) {
    throw new AppError(404, "That person is not assigned to this project", "PROJECT_MEMBER_NOT_FOUND");
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.delete({ where: { id: existing.id } });

    await tx.auditLog.create({
      data: {
        organizationId: project.organizationId,
        actorId,
        action: "project.member.remove",
        entityType: "ProjectMember",
        entityId: existing.id,
        metadataJson: { projectId, userId }
      }
    });
  });

  return { projectId, userId };
}
