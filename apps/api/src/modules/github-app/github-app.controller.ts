import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  disconnectInstallation,
  getInstallUrl,
  getStatus,
  linkInstallation,
  resolveGitHubUser,
  syncInstallation
} from "./github-app.service.js";
import {
  linkInstallationSchema,
  organizationQuerySchema,
  resolveGitHubUserQuerySchema,
  syncInstallationSchema
} from "./github-app.schemas.js";

/**
 * GitHub App management endpoints (JWT). The DevInside org is always taken from
 * the authenticated session/body, so an installation can only be linked to an
 * org the caller manages. Repository-mutating operations on GitHub are NOT here
 * (that is a future, separate DevOps concern).
 */
export const githubAppRouter = Router();
githubAppRouter.use(requireAuth);

/** Express 5 types a route param as string | string[]; normalize to a string. */
function pathId(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

githubAppRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const { organizationId } = organizationQuerySchema.parse(req.query);
    res.json(await getStatus(req.authUser!.id, organizationId));
  })
);

githubAppRouter.get(
  "/install-url",
  asyncHandler(async (req, res) => {
    const { organizationId } = organizationQuerySchema.parse(req.query);
    res.json(await getInstallUrl(req.authUser!.id, organizationId));
  })
);

githubAppRouter.get(
  "/resolve-user",
  asyncHandler(async (req, res) => {
    const { organizationId, username } = resolveGitHubUserQuerySchema.parse(req.query);
    const user = await resolveGitHubUser(req.authUser!.id, organizationId, username);
    res.status(200).json({ user });
  })
);

githubAppRouter.post(
  "/installations/callback",
  asyncHandler(async (req, res) => {
    const input = linkInstallationSchema.parse(req.body);
    res.json(await linkInstallation(req.authUser!.id, input));
  })
);

githubAppRouter.post(
  "/installations/:id/sync",
  asyncHandler(async (req, res) => {
    const { organizationId } = syncInstallationSchema.parse(req.body);
    res.json(await syncInstallation(req.authUser!.id, organizationId, pathId(req.params.id)));
  })
);

githubAppRouter.delete(
  "/installations/:id",
  asyncHandler(async (req, res) => {
    const { organizationId } = organizationQuerySchema.parse(req.query);
    res.json(await disconnectInstallation(req.authUser!.id, organizationId, pathId(req.params.id)));
  })
);
