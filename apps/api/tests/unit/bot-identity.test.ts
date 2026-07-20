import { describe, expect, it } from "vitest";

import { isBotUsername } from "../../src/modules/git-providers/bot-identity.js";

describe("isBotUsername", () => {
  it("recognizes GitHub bot suffixes case-insensitively", () => {
    expect(isBotUsername("github-actions[bot]")).toBe(true);
    expect(isBotUsername("Renovate[Bot]")).toBe(true);
  });

  it("recognizes known service accounts without a bot suffix", () => {
    expect(isBotUsername("dependabot")).toBe(true);
    expect(isBotUsername(" WEB-FLOW ")).toBe(true);
  });

  it("does not classify human or missing usernames as bots", () => {
    expect(isBotUsername("tanzilmia")).toBe(false);
    expect(isBotUsername(null)).toBe(false);
    expect(isBotUsername(undefined)).toBe(false);
  });
});
