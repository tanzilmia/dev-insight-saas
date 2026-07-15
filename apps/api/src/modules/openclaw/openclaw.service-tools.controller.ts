import { Router } from "express";
import { asyncHandler } from "../../common/http/async-handler.js";
import { listBranchNamesForRepositories } from "../activity/activity.service.js";
import { listEmployees } from "../employees/employees.service.js";
import { listProjects } from "../projects/projects.service.js";
import { listRepositories } from "../repositories/repositories.service.js";
import { requireServiceKey } from "./openclaw.middleware.js";
import { generateReportSchema } from "./openclaw.schemas.js";
import { orchestrateReport } from "./openclaw.service.js";

/**
 * Tool endpoints the OpenClaw runtime calls (via its DevInsight plugin),
 * authenticated with the service key plus an API-signed tenant context. Tenant
 * identity is derived from verified claims, never from tool-controlled input.
 * Uses per-route `requireServiceKey` so non-matching paths fall through to the
 * JWT router.
 */
export const openclawServiceRouter = Router();

// POST /api/openclaw/tools/generate-report
openclawServiceRouter.post(
  "/tools/generate-report",
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const context = req.openClawContext!;
    const input = generateReportSchema.parse({
      ...req.body,
      organizationId: context.organizationId
    });
    const report = await orchestrateReport(context.requesterId, input);

    res.status(200).json({ report });
  })
);

// GET /api/openclaw/tools/context — lets the agent resolve targets from names
openclawServiceRouter.get(
  "/tools/context",
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { organizationId, requesterId } = req.openClawContext!;

    const [repositories, projects, employees] = await Promise.all([
      listRepositories(requesterId, organizationId),
      listProjects(requesterId, organizationId),
      listEmployees(requesterId, organizationId)
    ]);

    const branchesByRepo = await listBranchNamesForRepositories(repositories.map((repo) => repo.id));

    res.status(200).json({
      context: {
        repositories: repositories.map((repo) => ({
          id: repo.id,
          fullName: repo.fullName,
          branches: branchesByRepo.get(repo.id) ?? []
        })),
        projects: projects.map((project) => ({ id: project.id, name: project.name })),
        employees: employees.map((employee) => ({
          id: employee.id,
          name: employee.name
        }))
      }
    });
  })
);
