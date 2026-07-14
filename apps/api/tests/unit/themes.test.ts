import { describe, expect, it } from "vitest";

import { buildThemesPrompt, parseThemes } from "../../src/modules/report-engine/themes.js";

describe("parseThemes", () => {
  it("parses a clean JSON array", () => {
    expect(parseThemes('[{"title":"Payments","summary":"Added retries","size":"large"}]')).toEqual([
      { title: "Payments", summary: "Added retries", size: "large" }
    ]);
  });

  it("tolerates markdown fences and preamble text", () => {
    const raw =
      'Sure! Here you go:\n```json\n[{"title":"Refund flow","summary":"Built refunds","size":"medium"}]\n```';
    const themes = parseThemes(raw);
    expect(themes).toHaveLength(1);
    expect(themes[0]?.title).toBe("Refund flow");
  });

  it("defaults an unknown or missing size to medium", () => {
    expect(parseThemes('[{"title":"X","summary":"y","size":"huge"}]')[0]?.size).toBe("medium");
    expect(parseThemes('[{"title":"X","summary":"y"}]')[0]?.size).toBe("medium");
  });

  it("skips entries without a title", () => {
    expect(parseThemes('[{"summary":"no title"},{"title":"Kept","summary":"ok"}]')).toEqual([
      { title: "Kept", summary: "ok", size: "medium" }
    ]);
  });

  it("caps at 6 themes", () => {
    const many = JSON.stringify(
      Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, summary: "s", size: "small" }))
    );
    expect(parseThemes(many)).toHaveLength(6);
  });

  it("truncates over-long titles (80) and summaries (240)", () => {
    const theme = parseThemes(
      `[{"title":"${"a".repeat(200)}","summary":"${"b".repeat(400)}","size":"small"}]`
    )[0]!;
    expect(theme.title.length).toBe(80);
    expect(theme.summary.length).toBe(240);
  });

  it("returns [] for empty, non-array or unparseable input", () => {
    expect(parseThemes("")).toEqual([]);
    expect(parseThemes("no brackets here")).toEqual([]);
    expect(parseThemes('{"title":"object not array"}')).toEqual([]);
    expect(parseThemes("[not valid json")).toEqual([]);
  });
});

describe("buildThemesPrompt", () => {
  it("returns a system + user message pair grounded in the commit list", () => {
    const messages = buildThemesPrompt([
      { message: "feat: add login\n\nbody text", author: "alice" },
      { message: "fix: null guard", author: "bob" }
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("feat: add login");
    expect(messages[1]?.content).toContain("fix: null guard");
    expect(messages[1]?.content).not.toContain("body text"); // first line only
  });

  it("caps the commit lines it includes at 120", () => {
    const commits = Array.from({ length: 200 }, (_, i) => ({ message: `commit ${i}`, author: null }));
    const content = buildThemesPrompt(commits)[1]!.content;
    expect(content).toContain("commit 119");
    expect(content).not.toContain("commit 120");
  });
});
