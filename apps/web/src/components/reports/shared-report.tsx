"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, Loader2, Printer, Sparkles } from "lucide-react";

import { type PublicReport, getApiErrorMessage, getPublicReport } from "@/lib/api";
import { ReportInsightsPanel, stripStructuredSections } from "./report-insights-panel";

const markdownPlugins = [remarkGfm];

function formatDate(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

export function SharedReport({ token }: { token: string }) {
  const [report, setReport] = useState<PublicReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State is set only inside .then/.catch/.finally (deferred), so calling from
  // the effect is safe under react-hooks/set-state-in-effect.
  useEffect(() => {
    getPublicReport(token)
      .then((data) => {
        setReport(data);
        setError(null);
      })
      .catch((caught) => setError(getApiErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <main className="mx-auto grid min-h-screen max-w-3xl gap-6 px-5 py-10">
      <header className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm font-black text-(--text)">
          <Sparkles size={16} className="text-(--accent)" />
          DevInsight
        </span>
        {report ? (
          <button
            type="button"
            onClick={() => window.print()}
            className="glass-soft glass-hover inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-(--text) print:hidden"
          >
            <Printer size={13} />
            Print / PDF
          </button>
        ) : null}
      </header>

      {loading ? (
        <div className="grid place-items-center py-24 text-(--muted)">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : error ? (
        <div className="glass grid place-items-center gap-2 rounded-xl p-12 text-center">
          <AlertTriangle size={22} className="text-amber-500" />
          <p className="text-sm font-bold text-(--text)">This report isn’t available.</p>
          <p className="text-sm text-(--muted)">{error}</p>
        </div>
      ) : report ? (
        <article className="glass rounded-xl p-6">
          <h1 className="text-2xl font-black tracking-tight text-(--text)">{report.title}</h1>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-(--muted)">
            {report.reportType} · {report.targetLabel} · {formatDate(report.period.from)} →{" "}
            {formatDate(report.period.to)}
          </p>

          {report.statistics ? (
            <div className="my-5 grid grid-cols-4 gap-2 text-center">
              {[
                ["Commits", report.statistics.commits],
                ["+Lines", report.statistics.additions],
                ["-Lines", report.statistics.deletions],
                ["Files", report.statistics.filesChanged]
              ].map(([label, value]) => (
                <div key={label} className="glass-soft rounded-2xl px-2 py-3">
                  <p className="text-lg font-black text-(--text)">{value}</p>
                  <p className="text-[10px] font-black uppercase tracking-wide text-(--muted)">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          <div className="my-5">
            <ReportInsightsPanel comparison={report.comparison} insights={report.insights} />
          </div>

          <div className="report-md">
            <ReactMarkdown remarkPlugins={markdownPlugins}>
              {report.comparison || report.insights
                ? stripStructuredSections(report.markdown)
                : report.markdown}
            </ReactMarkdown>
          </div>
        </article>
      ) : null}

      <footer className="text-center text-xs text-(--muted)">
        Shared via DevInsight — anyone with this link can view this report.
      </footer>
    </main>
  );
}
