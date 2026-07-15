import { env } from "../../config/env.js";

import type { CodeQualityProvider } from "./code-quality-provider.js";
import { SonarQubeProvider } from "./sonarqube.provider.js";

const sonarQubeProvider = new SonarQubeProvider();

/**
 * Returns the active code-quality provider. `CODE_QUALITY_PROVIDER` selects the
 * implementation; only SonarQube is wired today (self-hosted or, with
 * `SONAR_ORGANIZATION` set, SonarCloud — same Web API, same class).
 */
export function getCodeQualityProvider(): CodeQualityProvider {
  switch (env.CODE_QUALITY_PROVIDER) {
    case "sonarqube":
    default:
      return sonarQubeProvider;
  }
}
