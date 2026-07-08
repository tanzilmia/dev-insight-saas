import type { User } from "@prisma/client";

import type { SafeUser } from "./auth.types.js";

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt
  };
}

