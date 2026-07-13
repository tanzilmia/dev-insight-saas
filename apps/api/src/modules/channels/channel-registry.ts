import type { ChannelType } from "@prisma/client";

import { AppError } from "../../common/errors/app-error.js";
import type { ChannelProvider } from "./channel-provider.js";
import { TelegramProvider } from "./telegram/telegram.provider.js";

const providers: Record<ChannelType, ChannelProvider> = {
  TELEGRAM: new TelegramProvider()
};

/** Resolve the delivery provider for a channel type. */
export function getChannelProvider(type: ChannelType): ChannelProvider {
  const provider = providers[type];
  if (!provider) {
    throw new AppError(400, `Unsupported channel type: ${type}`, "CHANNEL_TYPE_UNSUPPORTED");
  }
  return provider;
}
