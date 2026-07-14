"use client";

import { useEffect, useState } from "react";
import { Award, Check, Crown, Loader2, Sparkles, Trophy } from "lucide-react";

import {
  type EmployeeAward,
  confirmAward,
  generateAwardShortlist,
  getApiErrorMessage,
  listAwards
} from "@/lib/api";

type Props = {
  organizationId: string;
  /** "org" or a projectId. */
  scope: string;
  projectName: string | null;
  canManage: boolean;
};

function groupByPeriod(awards: EmployeeAward[]): Map<string, EmployeeAward[]> {
  const map = new Map<string, EmployeeAward[]>();
  for (const award of awards) {
    const list = map.get(award.periodKey) ?? [];
    list.push(award);
    map.set(award.periodKey, list);
  }
  return map;
}

function AwardCard({
  award,
  maxScore,
  canManage,
  busy,
  onConfirm
}: {
  award: EmployeeAward;
  maxScore: number;
  canManage: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const confirmed = award.status === "CONFIRMED";
  const pct = maxScore > 0 ? Math.round((award.score / maxScore) * 100) : 0;

  return (
    <div
      className={`rounded-lg border p-3 ${
        confirmed
          ? "border-amber-500/40 bg-amber-500/10"
          : "border-(--border) bg-(--surface-soft)"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {confirmed ? (
            <Crown size={15} className="shrink-0 text-amber-500" />
          ) : (
            <span className="w-5 shrink-0 text-center text-xs font-bold text-(--muted)">
              #{award.rank}
            </span>
          )}
          <span className="truncate text-sm font-bold text-(--text)">{award.name}</span>
        </div>
        {confirmed ? (
          <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
            Winner
          </span>
        ) : canManage ? (
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-(--border) px-2 py-1 text-[11px] font-bold text-(--text) transition hover:bg-(--surface) disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Confirm
          </button>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-(--text)">{award.citation}</p>

      {award.detailsJson ? (
        <div className="mt-2.5 grid gap-1.5">
          {award.detailsJson.projects.length ? (
            <DetailRow label="Projects">
              <div className="flex flex-wrap gap-1">
                {award.detailsJson.projects.map((project) => (
                  <span
                    key={project}
                    className="rounded-full bg-(--surface) px-2 py-0.5 text-[11px] font-semibold text-(--text)"
                  >
                    {project}
                  </span>
                ))}
              </div>
            </DetailRow>
          ) : null}
          {award.detailsJson.workType ? (
            <DetailRow label="Focus">
              <span className="text-[11px] text-(--text) capitalize">{award.detailsJson.workType}</span>
            </DetailRow>
          ) : null}
          {award.detailsJson.areas.length ? (
            <DetailRow label="Areas">
              <span className="text-[11px] text-(--text)">{award.detailsJson.areas.join(", ")}</span>
            </DetailRow>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--border)">
          <div className="h-full rounded-full bg-(--accent)" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[10px] font-medium text-(--muted)">score {award.score.toFixed(2)}</span>
      </div>
      <p className="mt-1 text-[11px] text-(--muted)">
        {award.commits} commits · {award.lines.toLocaleString()} lines · {award.activeDays} active days
      </p>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 w-14 shrink-0 text-[10px] font-bold uppercase tracking-wide text-(--muted)">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function AwardsPanel({ organizationId, scope, projectName, canManage }: Props) {
  const [awards, setAwards] = useState<EmployeeAward[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // setState only inside .then/.catch/.finally (deferred) so this is safe to call
  // from an effect (react-hooks/set-state-in-effect). `loading` starts true.
  useEffect(() => {
    listAwards(organizationId, scope)
      .then((data) => {
        setAwards(data);
        setError(null);
      })
      .catch((caught) => setError(getApiErrorMessage(caught)))
      .finally(() => setLoading(false));
  }, [organizationId, scope]);

  function reload() {
    return listAwards(organizationId, scope)
      .then(setAwards)
      .catch((caught) => setError(getApiErrorMessage(caught)));
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setNote(null);
    try {
      const result = await generateAwardShortlist(organizationId, scope);
      await reload();
      if (!result.awards.length) {
        setNote(
          "No mapped employees had activity last month, so there is no shortlist. Map contributors to employees first."
        );
      } else {
        setNote(
          result.generatedBy === "template"
            ? "Shortlist ready (citations from a template — no AI configured)."
            : "Shortlist ready."
        );
      }
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setGenerating(false);
    }
  }

  async function handleConfirm(id: string) {
    setConfirmingId(id);
    setError(null);
    try {
      await confirmAward(id);
      await reload();
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setConfirmingId(null);
    }
  }

  const byPeriod = groupByPeriod(awards);
  const periods = [...byPeriod.keys()].sort((a, b) => b.localeCompare(a));
  const latest = periods[0];
  const latestAwards = latest ? byPeriod.get(latest)!.filter((a) => a.status !== "DISMISSED") : [];
  const maxScore = Math.max(0, ...latestAwards.map((a) => a.score));
  const pastWinners = periods
    .slice(1)
    .map((period) => byPeriod.get(period)!.find((a) => a.status === "CONFIRMED"))
    .filter((a): a is EmployeeAward => Boolean(a));

  return (
    <div className="glass rounded-xl p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy size={16} className="text-amber-500" />
          <h2 className="text-sm font-bold text-(--text)">Employee of the month</h2>
          {projectName ? (
            <span className="text-xs font-medium text-(--muted)">{projectName}</span>
          ) : null}
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            title="Score last month's activity and draft a shortlist for you to confirm"
            className="btn-gradient inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-bold disabled:opacity-60"
          >
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {latestAwards.length ? "Regenerate" : "Generate shortlist"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mb-3 text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      {note ? <p className="mb-3 text-xs font-medium text-(--muted)">{note}</p> : null}

      {loading ? (
        <div className="grid place-items-center py-6 text-(--muted)">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : latestAwards.length ? (
        <>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-(--muted)">
            {latest} shortlist
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {latestAwards
              .sort((a, b) =>
                a.status === "CONFIRMED" ? -1 : b.status === "CONFIRMED" ? 1 : a.rank - b.rank
              )
              .map((award) => (
                <AwardCard
                  key={award.id}
                  award={award}
                  maxScore={maxScore}
                  canManage={canManage}
                  busy={confirmingId === award.id}
                  onConfirm={() => handleConfirm(award.id)}
                />
              ))}
          </div>
        </>
      ) : (
        <p className="py-2 text-sm text-(--muted)">
          No shortlist yet.
          {canManage ? " Generate one to recognize last month's top contributors." : ""}
        </p>
      )}

      {pastWinners.length ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-(--muted)">
            Past winners
          </p>
          <ul className="grid gap-1.5">
            {pastWinners.map((winner) => (
              <li
                key={winner.id}
                className="flex items-center gap-2 rounded-lg bg-(--surface-soft) px-3 py-2 text-sm"
              >
                <Award size={14} className="shrink-0 text-amber-500" />
                <span className="font-semibold text-(--text)">{winner.name}</span>
                <span className="text-xs text-(--muted)">— {winner.periodKey}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-(--muted)">
        A recognition suggestion from activity signals — not a performance verdict. A manager
        decides the winner.
      </p>
    </div>
  );
}
