// Automated accounts that should not contribute human activity to reports.
// GitHub App bot accounts normally use the `[bot]` login suffix; the explicit
// list covers older/common service accounts whose login does not use that form.
export const KNOWN_BOT_LOGINS = new Set([
  "web-flow",
  "dependabot",
  "dependabot-preview",
  "github-actions",
  "renovate",
  "renovate-bot",
  "greenkeeper",
  "snyk-bot",
  "imgbot",
  "mergify",
  "codecov"
]);

export function isBotUsername(username?: string | null): boolean {
  if (!username) {
    return false;
  }

  const login = username.trim().toLowerCase();
  return login.endsWith("[bot]") || KNOWN_BOT_LOGINS.has(login);
}
