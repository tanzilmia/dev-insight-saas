import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  assignRepositoryProjectSchema,
  orgQuerySchema,
  repositoryParamsSchema,
  setSonarProjectKeySchema
} from "./repositories.schemas.js";
import {
  assignRepositoryProject,
  listRepositories,
  resyncRepository,
  setRepositorySonarProjectKey
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

repositoriesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = repositoryParamsSchema.parse(req.params);
    const { projectId } = assignRepositoryProjectSchema.parse(req.body);
    const repository = await assignRepositoryProject(req.authUser!.id, id, projectId);

    res.status(200).json({ repository });
  })
);

// PATCH /api/repositories/:id/sonar-project — set/clear the SonarQube project key.
repositoriesRouter.patch(
  "/:id/sonar-project",
  asyncHandler(async (req, res) => {
    const { id } = repositoryParamsSchema.parse(req.params);
    const { sonarProjectKey } = setSonarProjectKeySchema.parse(req.body);
    const repository = await setRepositorySonarProjectKey(req.authUser!.id, id, sonarProjectKey);

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
