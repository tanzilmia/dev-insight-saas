import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../common/http/async-handler.js";
import { listEmployees } from "../employees/employees.service.js";
import { listProjects } from "../projects/projects.service.js";
import { listRepositories } from "../repositories/repositories.service.js";
import { requireServiceKey } from "./openclaw.middleware.js";
import { generateReportSchema } from "./openclaw.schemas.js";
import { orchestrateReport } from "./openclaw.service.js";

const requesterSchema = z.object({ requesterId: z.string().min(1) });
const contextQuerySchema = z.object({
  organizationId: z.string().min(1),
  requesterId: z.string().min(1)
});

/**
 * Tool endpoints the OpenClaw runtime calls (via its DevInsight plugin),
 * authenticated with the service key. `requesterId` is the DevInsight user the
 * agent acts for; org membership is still enforced downstream. Uses per-route
 * `requireServiceKey` so non-matching paths fall through to the JWT router.
 */
export const openclawServiceRouter = Router();

// POST /api/openclaw/tools/generate-report
openclawServiceRouter.post(
  "/tools/generate-report",
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { requesterId } = requesterSchema.parse(req.body);
    const input = generateReportSchema.parse(req.body);
    const report = await orchestrateReport(requesterId, input);

    res.status(200).json({ report });
  })
);

// GET /api/openclaw/tools/context — lets the agent resolve targets from names
openclawServiceRouter.get(
  "/tools/context",
  requireServiceKey,
  asyncHandler(async (req, res) => {
    const { organizationId, requesterId } = contextQuerySchema.parse(req.query);

    const [repositories, projects, employees] = await Promise.all([
      listRepositories(requesterId, organizationId),
      listProjects(requesterId, organizationId),
      listEmployees(requesterId, organizationId)
    ]);

    res.status(200).json({
      context: {
        repositories: repositories.map((repo) => ({
          id: repo.id,
          fullName: repo.fullName
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
