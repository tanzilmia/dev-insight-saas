import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { listOrganizationsForUser } from "./organizations.service.js";

export const organizationsRouter = Router();

organizationsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const organizations = await listOrganizationsForUser(req.authUser!.id);

    res.status(200).json({ organizations });
  })
);

