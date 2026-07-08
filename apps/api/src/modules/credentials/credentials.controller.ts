import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  createCredentialSchema,
  credentialParamsSchema,
  listCredentialsQuerySchema,
  reconnectCredentialSchema
} from "./credentials.schemas.js";
import {
  connectCredential,
  deleteCredential,
  listCredentials,
  reconnectCredential,
  validateStoredCredential
} from "./credentials.service.js";

export const credentialsRouter = Router();

credentialsRouter.use(requireAuth);

credentialsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { organizationId } = listCredentialsQuerySchema.parse(req.query);
    const credentials = await listCredentials(req.authUser!.id, organizationId);

    res.status(200).json({ credentials });
  })
);

credentialsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const payload = createCredentialSchema.parse(req.body);
    const credential = await connectCredential(req.authUser!.id, payload);

    res.status(201).json({ credential });
  })
);

credentialsRouter.post(
  "/:id/validate",
  asyncHandler(async (req, res) => {
    const { id } = credentialParamsSchema.parse(req.params);
    const credential = await validateStoredCredential(req.authUser!.id, id);

    res.status(200).json({ credential });
  })
);

credentialsRouter.patch(
  "/:id/reconnect",
  asyncHandler(async (req, res) => {
    const { id } = credentialParamsSchema.parse(req.params);
    const { token } = reconnectCredentialSchema.parse(req.body);
    const credential = await reconnectCredential(req.authUser!.id, id, token);

    res.status(200).json({ credential });
  })
);

credentialsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = credentialParamsSchema.parse(req.params);
    const result = await deleteCredential(req.authUser!.id, id);

    res.status(200).json(result);
  })
);
