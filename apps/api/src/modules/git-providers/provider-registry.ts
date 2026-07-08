import type { GitProvider as GitProviderName } from "@prisma/client";

import { AppError } from "../../common/errors/app-error.js";
import { GitHubProvider } from "../github/github.provider.js";
import type { GitProvider } from "./git-provider.js";

const githubProvider = new GitHubProvider();

/** Resolves the provider implementation for a stored credential's provider. */
export function getGitProvider(provider: GitProviderName): GitProvider {
  switch (provider) {
    case "GITHUB":
      return githubProvider;
    default:
      throw new AppError(400, `${provider} is not supported yet`, "PROVIDER_UNSUPPORTED");
  }
}
