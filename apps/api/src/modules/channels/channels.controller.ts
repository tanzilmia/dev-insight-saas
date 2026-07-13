import { Router } from "express";

import { asyncHandler } from "../../common/http/async-handler.js";
import { requireAuth } from "../auth/auth.middleware.js";
import {
  channelParamsSchema,
  createChannelSchema,
  detectChatsSchema,
  listChannelsQuerySchema,
  sendReportSchema,
  updateChannelSchema
} from "./channels.schemas.js";
import {
  createChannel,
  deleteChannel,
  detectChats,
  listChannels,
  sendReportToChannel,
  testChannel,
  updateChannel
} from "./channels.service.js";

export const channelsRouter = Router();

channelsRouter.use(requireAuth);

channelsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { organizationId } = listChannelsQuerySchema.parse(req.query);
    const channels = await listChannels(req.authUser!.id, organizationId);
    res.status(200).json({ channels });
  })
);

channelsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = createChannelSchema.parse(req.body);
    const channel = await createChannel(req.authUser!.id, input);
    res.status(201).json({ channel });
  })
);

channelsRouter.post(
  "/detect",
  asyncHandler(async (req, res) => {
    const input = detectChatsSchema.parse(req.body);
    const chats = await detectChats(req.authUser!.id, input);
    res.status(200).json({ chats });
  })
);

channelsRouter.post(
  "/send-report",
  asyncHandler(async (req, res) => {
    const input = sendReportSchema.parse(req.body);
    const result = await sendReportToChannel(req.authUser!.id, input);
    res.status(200).json(result);
  })
);

channelsRouter.post(
  "/:id/test",
  asyncHandler(async (req, res) => {
    const { id } = channelParamsSchema.parse(req.params);
    const result = await testChannel(req.authUser!.id, id);
    res.status(200).json(result);
  })
);

channelsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = channelParamsSchema.parse(req.params);
    const input = updateChannelSchema.parse(req.body);
    const channel = await updateChannel(req.authUser!.id, id, input);
    res.status(200).json({ channel });
  })
);

channelsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = channelParamsSchema.parse(req.params);
    const result = await deleteChannel(req.authUser!.id, id);
    res.status(200).json(result);
  })
);
