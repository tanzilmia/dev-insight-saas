import type { GitProvider as GitProviderName } from "@prisma/client";

import { AppError } from "../../common/errors/app-error.js";
import { githubDevOpsProvider } from "../github-devops/github-devops.provider.js";
import type { DevOpsProvider } from "./devops-provider.js";

/** Resolves the DevOps provider for a repository's Git provider. */
export function getDevOpsProvider(provider: GitProviderName): DevOpsProvider {
  if (provider === "GITHUB") {
    return githubDevOpsProvider;
  }
  throw new AppError(
    400,
    `DevOps automation is not supported for ${provider} yet.`,
    "PROVIDER_UNSUPPORTED"
  );
}
