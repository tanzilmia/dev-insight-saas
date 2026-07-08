import type { OrgRole, User } from "@prisma/client";

export type SafeUser = Pick<User, "id" | "name" | "email" | "status" | "createdAt">;

export type AuthUser = {
  id: string;
  email: string;
  memberships: Array<{
    organizationId: string;
    role: OrgRole;
  }>;
};

