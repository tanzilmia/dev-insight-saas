import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  assignRepositoryProjectSchema,
  orgQuerySchema,
  repositoryParamsSchema,
  selectRepositoriesSchema,
  syncRepositoriesSchema
} from "./repositories.schemas.js";
import {
  assignRepositoryProject,
  disableLiveSync,
  enableLiveSync,
  listRepositories,
  resyncRepository,
  selectRepositories,
  syncRepositories,
  untrackRepository
} from "./repositories.service.js";

export const repositoriesRouter = Router();

repositoriesRouter.use(requireAuth);

repositoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { organizationId } = orgQuerySchema.parse(req.query);
    const repositories = await listRepositories(req.authUser!.id, organizationId);

    res.status(200).json({ repositories });
  })
);

repositoriesRouter.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const { organizationId } = syncRepositoriesSchema.parse(req.body);
    const repositories = await syncRepositories(req.authUser!.id, organizationId);

    res.status(200).json({ repositories });
  })
);

repositoriesRouter.post(
  "/select",
  asyncHandler(async (req, res) => {
    const { organizationId, repositories } = selectRepositoriesSchema.parse(req.body);
    const saved = await selectRepositories(req.authUser!.id, organizationId, repositories);

    res.status(200).json({ repositories: saved });
  })
);

repositoriesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = repositoryParamsSchema.parse(req.params);
    const { projectId } = assignRepositoryProjectSchema.parse(req.body);
    const repository = await assignRepositoryProject(req.authUser!.id, id, projectId);

    res.status(200).json({ repository });
  })
);

repositoriesRouter.post(
  "/:id/resync",
  asyncHandler(async (req, res) => {
    const { id } = repositoryParamsSchema.parse(req.params);
    const repository = await resyncRepository(req.authUser!.id, id);

    res.status(200).json({ repository });
  })
);

repositoriesRouter.post(
  "/:id/live-sync",
  asyncHandler(async (req, res) => {
    const { id } = repositoryParamsSchema.parse(req.params);
    const repository = await enableLiveSync(req.authUser!.id, id);

    res.status(200).json({ repository });
  })
);

repositoriesRouter.delete(
  "/:id/live-sync",
  asyncHandler(async (req, res) => {
    const { id } = repositoryParamsSchema.parse(req.params);
    const repository = await disableLiveSync(req.authUser!.id, id);

    res.status(200).json({ repository });
  })
);

repositoriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = repositoryParamsSchema.parse(req.params);
    const result = await untrackRepository(req.authUser!.id, id);

    res.status(200).json(result);
  })
);
