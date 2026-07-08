import { prisma } from "../../config/database.js";

export async function listOrganizationsForUser(userId: string) {
  const memberships = await prisma.organizationMember.findMany({
    where: {
      userId,
      status: "ACTIVE"
    },
    include: {
      organization: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return memberships.map((membership) => ({
    id: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    role: membership.role,
    createdAt: membership.organization.createdAt
  }));
}

