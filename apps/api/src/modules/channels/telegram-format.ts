/**
 * Converts report Markdown into clean, Telegram-friendly plain text and splits
 * it into per-message chunks. Plain text (no parse_mode) is deliberate: it can
 * never fail on Markdown/HTML escaping, so a report always delivers. Tables
 * become "cell · cell" lines, headings/bold markers are stripped, links are
 * flattened to their text (the report is sent inline, not as a link).
 */

function stripInline(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) / ![alt](url) → text/alt
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // **bold** / __bold__
    .replace(/(\*|_)(.*?)\1/g, "$2") // *italic* / _italic_
    .replace(/`([^`]+)`/g, "$1"); // `code`
}

export function markdownToPlainText(markdown: string): string {
  const out: string[] = [];
  let inFence = false;

  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw;

    if (/^\s*```/.test(line)) {
      inFence = !inFence; // drop the fence markers, keep the content
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      continue;
    }
    // Heading → its text on its own line, with a blank line before it
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      if (out.length && out[out.length - 1] !== "") {
        out.push("");
      }
      out.push(stripInline(heading[1]!.trim()));
      continue;
    }
    // Table row
    if (/^\s*\|(.+)\|\s*$/.test(line)) {
      const cells = line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) {
        continue; // separator row (|---|:--:|)
      }
      out.push(cells.filter((c) => c !== "").map(stripInline).join("  ·  "));
      continue;
    }
    // Bullet list
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      out.push(`• ${stripInline(bullet[1]!)}`);
      continue;
    }
    // Blockquote
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      out.push(stripInline(quote[1]!));
      continue;
    }

    out.push(stripInline(line));
  }

  // Collapse 3+ blank lines to a single blank line, trim ends.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Splits text into ≤max-char chunks, preferring paragraph then line breaks. */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) {
    return text.length ? [text] : [];
  }
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) {
      chunks.push(current);
      current = "";
    }
  };
  const addPiece = (piece: string, sep: string) => {
    if (!current) {
      current = piece;
    } else if (current.length + sep.length + piece.length <= max) {
      current += sep + piece;
    } else {
      flush();
      current = piece;
    }
  };

  for (const para of text.split("\n\n")) {
    if (para.length <= max) {
      addPiece(para, "\n\n");
      continue;
    }
    // Paragraph too big → break by line
    flush();
    for (const line of para.split("\n")) {
      if (line.length <= max) {
        addPiece(line, "\n");
        continue;
      }
      // Single line too big → hard slice
      flush();
      for (let i = 0; i < line.length; i += max) {
        chunks.push(line.slice(i, i + max));
      }
    }
  }
  flush();
  return chunks;
}

type ReportLike = {
  title: string;
  markdown: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  statistics?: {
    commits?: number;
    additions?: number;
    deletions?: number;
    filesChanged?: number;
  } | null;
};

function dateLabel(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Builds the ordered list of Telegram messages for a report: a compact header
 * (title, period, headline stats) followed by the converted body, split to fit
 * the per-message limit. The Markdown's own leading H1 is dropped to avoid
 * duplicating the title.
 */
export function buildReportMessages(report: ReportLike, limit: number): string[] {
  const stats = report.statistics ?? {};
  const headerLines = [
    `📊 ${report.title}`,
    `🗓 ${dateLabel(report.periodStart)} → ${dateLabel(report.periodEnd)}`
  ];
  if (typeof stats.commits === "number") {
    headerLines.push(
      `📈 ${stats.commits} commits · +${stats.additions ?? 0}/−${stats.deletions ?? 0} · ${stats.filesChanged ?? 0} files`
    );
  }

  // Drop a leading H1 (the title) so it isn't shown twice.
  const body = markdownToPlainText(report.markdown.replace(/^\s*#\s+.*(?:\n|$)/, ""));

  const full = `${headerLines.join("\n")}\n\n${body}`.trim();
  return chunkText(full, limit);
}
