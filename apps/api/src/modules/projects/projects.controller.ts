import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  addProjectMemberSchema,
  createProjectSchema,
  listProjectsQuerySchema,
  projectMemberParamsSchema,
  projectParamsSchema,
  updateProjectSchema
} from "./projects.schemas.js";
import {
  addProjectMember,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  removeProjectMember,
  updateProject
} from "./projects.service.js";

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

projectsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { organizationId, status } = listProjectsQuerySchema.parse(req.query);
    const projects = await listProjects(req.authUser!.id, organizationId, status);

    res.status(200).json({ projects });
  })
);

projectsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = createProjectSchema.parse(req.body);
    const project = await createProject(req.authUser!.id, payload);

    res.status(201).json({ project });
  })
);

projectsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = projectParamsSchema.parse(req.params);
    const project = await getProject(req.authUser!.id, id);

    res.status(200).json({ project });
  })
);

projectsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = projectParamsSchema.parse(req.params);
    const payload = updateProjectSchema.parse(req.body);
    const project = await updateProject(req.authUser!.id, id, payload);

    res.status(200).json({ project });
  })
);

projectsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = projectParamsSchema.parse(req.params);
    const result = await deleteProject(req.authUser!.id, id);

    res.status(200).json(result);
  })
);

projectsRouter.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const { id } = projectParamsSchema.parse(req.params);
    const payload = addProjectMemberSchema.parse(req.body);
    const member = await addProjectMember(req.authUser!.id, id, payload);

    res.status(201).json({ member });
  })
);

projectsRouter.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const { id, userId } = projectMemberParamsSchema.parse(req.params);
    const result = await removeProjectMember(req.authUser!.id, id, userId);

    res.status(200).json(result);
  })
);
