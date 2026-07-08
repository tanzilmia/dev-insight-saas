import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { prisma } from "../../config/database.js";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/app-error.js";
import { createSlug } from "../../common/utils/slug.js";
import type { AuthUser } from "./auth.types.js";
import { toSafeUser } from "./auth.utils.js";

type RegisterInput = {
  name: string;
  email: string;
  password: string;
  organizationName: string;
};

type LoginInput = {
  email: string;
  password: string;
};

function signAccessToken(user: AuthUser) {
  return jwt.sign(user, env.JWT_ACCESS_SECRET, {
    expiresIn: "7d",
    subject: user.id
  });
}

async function createUniqueOrganizationSlug(name: string) {
  const baseSlug = createSlug(name);
  let slug = baseSlug;
  let attempt = 1;

  while (await prisma.organization.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  return slug;
}

export async function register(input: RegisterInput) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (existingUser) {
    throw new AppError(409, "An account already exists for this email", "EMAIL_EXISTS");
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const organizationSlug = await createUniqueOrganizationSlug(input.organizationName);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash
      }
    });

    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug: organizationSlug,
        members: {
          create: {
            userId: user.id,
            role: "OWNER"
          }
        }
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: organization.id,
        actorId: user.id,
        action: "auth.register",
        entityType: "User",
        entityId: user.id,
        metadataJson: {
          organizationId: organization.id
        }
      }
    });

    return { user, organization };
  });

  const authUser: AuthUser = {
    id: result.user.id,
    email: result.user.email,
    memberships: [
      {
        organizationId: result.organization.id,
        role: "OWNER"
      }
    ]
  };

  return {
    accessToken: signAccessToken(authUser),
    user: toSafeUser(result.user),
    organization: result.organization
  };
}

export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        select: {
          organizationId: true,
          role: true
        }
      }
    }
  });

  if (!user) {
    throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);

  if (!passwordMatches) {
    throw new AppError(401, "Invalid email or password", "INVALID_CREDENTIALS");
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    memberships: user.memberships
  };

  return {
    accessToken: signAccessToken(authUser),
    user: toSafeUser(user),
    memberships: user.memberships
  };
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        include: {
          organization: true
        }
      }
    }
  });

  if (!user) {
    throw new AppError(401, "Authenticated user was not found", "AUTH_USER_NOT_FOUND");
  }

  return {
    user: toSafeUser(user),
    organizations: user.memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role
    }))
  };
}

