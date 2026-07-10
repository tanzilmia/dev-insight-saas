import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  addGitAliasSchema,
  createEmployeeSchema,
  employeeParamsSchema,
  gitAliasParamsSchema,
  listEmployeesQuerySchema,
  removeGitAliasQuerySchema,
  updateEmployeeSchema
} from "./employees.schemas.js";
import {
  addEmployee,
  addEmployeeGitAlias,
  getEmployee,
  listEmployees,
  removeEmployeeGitAlias,
  updateEmployee
} from "./employees.service.js";

export const employeesRouter = Router();

employeesRouter.use(requireAuth);

employeesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { organizationId } = listEmployeesQuerySchema.parse(req.query);
    const employees = await listEmployees(req.authUser!.id, organizationId);

    res.status(200).json({ employees });
  })
);

employeesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = createEmployeeSchema.parse(req.body);
    const employee = await addEmployee(req.authUser!.id, payload);

    res.status(201).json({ employee });
  })
);

employeesRouter.get(
  "/:userId",
  asyncHandler(async (req, res) => {
    const { userId } = employeeParamsSchema.parse(req.params);
    const { organizationId } = listEmployeesQuerySchema.parse(req.query);
    const employee = await getEmployee(req.authUser!.id, organizationId, userId);

    res.status(200).json({ employee });
  })
);

employeesRouter.patch(
  "/:userId",
  asyncHandler(async (req, res) => {
    const { userId } = employeeParamsSchema.parse(req.params);
    const payload = updateEmployeeSchema.parse(req.body);
    const employee = await updateEmployee(req.authUser!.id, userId, payload);

    res.status(200).json({ employee });
  })
);

employeesRouter.post(
  "/:userId/git-aliases",
  asyncHandler(async (req, res) => {
    const { userId } = employeeParamsSchema.parse(req.params);
    const payload = addGitAliasSchema.parse(req.body);
    const employee = await addEmployeeGitAlias(req.authUser!.id, userId, payload);

    res.status(201).json({ employee });
  })
);

employeesRouter.delete(
  "/:userId/git-aliases/:aliasId",
  asyncHandler(async (req, res) => {
    const { userId, aliasId } = gitAliasParamsSchema.parse(req.params);
    const { organizationId } = removeGitAliasQuerySchema.parse(req.query);
    const employee = await removeEmployeeGitAlias(
      req.authUser!.id,
      organizationId,
      userId,
      aliasId
    );

    res.status(200).json({ employee });
  })
);
