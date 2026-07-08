import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  contributorParamsSchema,
  discoverSchema,
  ignoreContributorSchema,
  mapContributorSchema,
  repoQuerySchema
} from "./contributors.schemas.js";
import {
  discoverContributors,
  listContributors,
  listUnmappedContributors,
  mapContributor,
  setContributorIgnored,
  unmapContributor
} from "./contributors.service.js";

export const contributorsRouter = Router();

contributorsRouter.use(requireAuth);

contributorsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repoQuerySchema.parse(req.query);
    const contributors = await listContributors(req.authUser!.id, repositoryId);

    res.status(200).json({ contributors });
  })
);

contributorsRouter.get(
  "/unmapped",
  asyncHandler(async (req, res) => {
    const { repositoryId } = repoQuerySchema.parse(req.query);
    const contributors = await listUnmappedContributors(req.authUser!.id, repositoryId);

    res.status(200).json({ contributors });
  })
);

contributorsRouter.post(
  "/discover",
  asyncHandler(async (req, res) => {
    const { repositoryId } = discoverSchema.parse(req.body);
    const contributors = await discoverContributors(req.authUser!.id, repositoryId);

    res.status(200).json({ contributors });
  })
);

contributorsRouter.post(
  "/:id/map",
  asyncHandler(async (req, res) => {
    const { id } = contributorParamsSchema.parse(req.params);
    const { userId, isPrimary } = mapContributorSchema.parse(req.body);
    const contributor = await mapContributor(req.authUser!.id, id, userId, isPrimary);

    res.status(200).json({ contributor });
  })
);

contributorsRouter.delete(
  "/:id/map",
  asyncHandler(async (req, res) => {
    const { id } = contributorParamsSchema.parse(req.params);
    const contributor = await unmapContributor(req.authUser!.id, id);

    res.status(200).json({ contributor });
  })
);

contributorsRouter.post(
  "/:id/ignore",
  asyncHandler(async (req, res) => {
    const { id } = contributorParamsSchema.parse(req.params);
    const { ignored } = ignoreContributorSchema.parse(req.body);
    const contributor = await setContributorIgnored(req.authUser!.id, id, ignored);

    res.status(200).json({ contributor });
  })
);
