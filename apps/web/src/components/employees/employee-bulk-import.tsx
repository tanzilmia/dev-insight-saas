"use client";

import { useState } from "react";
import { CheckCircle2, FileUp, Loader2, Upload, X } from "lucide-react";

import {
  type AssignableRole,
  type BulkEmployeeRow,
  type BulkImportSummary,
  bulkCreateEmployees,
  getApiErrorMessage
} from "@/lib/api";

const ROLES: AssignableRole[] = ["EMPLOYEE", "MANAGER", "ADMIN"];

type ParseResult = {
  rows: BulkEmployeeRow[];
  errors: string[];
};

/**
 * Parses pasted CSV text into employee rows. Columns: name, email, role,
 * gitUsernames. `gitUsernames` may hold several handles separated by space,
 * semicolon, or pipe (never comma — comma is the column separator). A header
 * line (containing "name" and "email") is skipped. Malformed lines are reported,
 * not silently dropped.
 */
function parseCsv(text: string): ParseResult {
  const rows: BulkEmployeeRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const cells = trimmed.split(",").map((cell) => cell.trim());
    const lower = trimmed.toLowerCase();
    // Skip an obvious header row.
    if (index === 0 && lower.includes("name") && lower.includes("email")) return;

    const [name, email, roleRaw, gitRaw] = cells;
    if (!name || name.length < 2) {
      errors.push(`Line ${index + 1}: missing or too-short name`);
      return;
    }
    if (!email || !email.includes("@")) {
      errors.push(`Line ${index + 1}: missing or invalid email`);
      return;
    }
    const roleUpper = roleRaw?.toUpperCase();
    const role = ROLES.includes(roleUpper as AssignableRole)
      ? (roleUpper as AssignableRole)
      : undefined;
    const gitUsernames = gitRaw
      ? gitRaw
          .split(/[;\s|]+/)
          .map((handle) => handle.replace(/^@/, "").trim())
          .filter(Boolean)
      : undefined;

    rows.push({ name, email, role, gitUsernames });
  });

  return { rows, errors };
}

export function EmployeeBulkImport({
  organizationId,
  onImported
}: {
  organizationId: string;
  onImported: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<BulkImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setText("");
    setParsed(null);
    setSummary(null);
    setError(null);
  }

  function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setText(content);
      setParsed(parseCsv(content));
      setSummary(null);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!parsed?.rows.length) return;
    setImporting(true);
    setError(null);
    try {
      const result = await bulkCreateEmployees({ organizationId, employees: parsed.rows });
      setSummary(result);
      onImported();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setImporting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass-soft glass-hover inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-(--text)"
      >
        <FileUp size={15} />
        Bulk import from CSV
      </button>
    );
  }

  const failures = summary?.results.filter((r) => r.status === "failed") ?? [];
  const skipped = summary?.results.filter((r) => r.status === "skipped") ?? [];

  return (
    <div className="glass grid gap-3 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-(--text)">Bulk import employees</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          className="text-(--muted) transition hover:text-(--text)"
          aria-label="Close bulk import"
        >
          <X size={16} />
        </button>
      </div>

      <p className="text-xs text-(--muted)">
        One employee per line: <code className="text-(--text)">name, email, role, github-handles</code>.
        Role is optional (defaults to Employee). Separate multiple GitHub handles with spaces or
        semicolons. A header row is ignored.
      </p>

      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setParsed(null);
          setSummary(null);
        }}
        rows={6}
        placeholder={"Ada Lovelace, ada@acme.com, EMPLOYEE, ada-l\nGrace Hopper, grace@acme.com, MANAGER, ghopper amazing-grace"}
        className="field w-full resize-y font-mono text-xs"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="glass-soft glass-hover inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-(--text)">
          <Upload size={13} />
          Upload .csv
          <input type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} className="hidden" />
        </label>
        <button
          type="button"
          onClick={() => setParsed(parseCsv(text))}
          disabled={!text.trim()}
          className="glass-soft glass-hover inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-(--text) disabled:opacity-50"
        >
          Preview
        </button>
      </div>

      {parsed ? (
        <div className="grid gap-2 rounded-lg border border-(--border) bg-(--surface-soft) p-3 text-xs">
          <p className="font-bold text-(--text)">
            {parsed.rows.length} valid row{parsed.rows.length === 1 ? "" : "s"}
            {parsed.errors.length ? ` · ${parsed.errors.length} skipped` : ""}
          </p>
          {parsed.rows.slice(0, 5).map((row, index) => (
            <p key={index} className="text-(--muted)">
              {row.name} · {row.email} · {row.role ?? "EMPLOYEE"}
              {row.gitUsernames?.length ? ` · @${row.gitUsernames.join(", @")}` : ""}
            </p>
          ))}
          {parsed.rows.length > 5 ? (
            <p className="text-(--muted)">…and {parsed.rows.length - 5} more</p>
          ) : null}
          {parsed.errors.length ? (
            <div className="mt-1 border-t border-(--border) pt-1 text-amber-600 dark:text-amber-400">
              {parsed.errors.slice(0, 4).map((err, index) => (
                <p key={index}>{err}</p>
              ))}
              {parsed.errors.length > 4 ? <p>…and {parsed.errors.length - 4} more</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {summary ? (
        <div className="grid gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
          <p className="inline-flex items-center gap-1.5 font-bold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={14} />
            Added {summary.created} of {summary.total}
            {skipped.length ? ` · ${skipped.length} already existed` : ""}
            {failures.length ? ` · ${failures.length} failed` : ""}
          </p>
          {failures.length ? (
            <div className="text-(--muted)">
              {failures.slice(0, 5).map((row, index) => (
                <p key={index}>
                  {row.email}: {row.message}
                </p>
              ))}
              {failures.length > 5 ? <p>…and {failures.length - 5} more</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {parsed?.rows.length && !summary ? (
        <button
          type="button"
          onClick={handleImport}
          disabled={importing}
          className="btn-gradient inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-60"
        >
          {importing ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
          Import {parsed.rows.length} employee{parsed.rows.length === 1 ? "" : "s"}
        </button>
      ) : null}
    </div>
  );
}
