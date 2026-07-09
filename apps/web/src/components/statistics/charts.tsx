"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";

/** A single headline number (form: stat tile — not a chart). */
export function StatTile({
  label,
  value,
  icon: Icon
}: {
  label: string;
  value: number | string;
  icon?: LucideIcon;
}) {
  return (
    <div className="glass rounded-xl p-4">
      {Icon ? (
        <span className="mb-2.5 inline-grid h-8 w-8 place-items-center rounded-lg bg-(--accent-soft) text-(--accent)">
          <Icon size={16} />
        </span>
      ) : null}
      <p className="text-2xl font-bold tracking-tight text-(--text)">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-(--muted)">{label}</p>
    </div>
  );
}

/** Horizontal magnitude bars, single hue (identity is the label, not color). */
export function BarList({
  items,
  unit = ""
}: {
  items: { label: string; value: number; sub?: string }[];
  unit?: string;
}) {
  if (!items.length) {
    return <p className="py-6 text-center text-sm text-(--muted)">No data in this period.</p>;
  }
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="grid gap-3">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} title={`${item.label}: ${item.value.toLocaleString()}${unit}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-(--text)">
              {item.label}
              {item.sub ? <span className="ml-2 text-xs text-(--muted)">{item.sub}</span> : null}
            </span>
            <span className="shrink-0 text-xs font-semibold text-(--muted)">
              {item.value.toLocaleString()}
              {unit}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-(--surface-soft)">
            <div
              className="h-full rounded-full bg-(--accent)"
              style={{ width: `${Math.max(3, (item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

type SeriesPoint = { date: string; value: number };

/** Change-over-time area+line, single series (no legend), with a hover crosshair. */
export function AreaChart({ data, unit = "" }: { data: SeriesPoint[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 640;
  const H = 200;
  const padX = 8;
  const padTop = 12;
  const padBottom = 8;
  const plotW = W - padX * 2;
  const plotH = H - padTop - padBottom;
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.value));

  const x = (i: number) => padX + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = n
    ? `${line} L${x(n - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`
    : "";
  const gridYs = [0.25, 0.5, 0.75, 1].map((f) => padTop + plotH - f * plotH);

  function handleMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, index)));
  }

  const active = hover !== null ? data[hover] : undefined;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height: 200 }}
        onPointerMove={handleMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="devinsight-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.26" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridYs.map((gy) => (
          <line key={gy} x1={padX} x2={W - padX} y1={gy} y2={gy} stroke="var(--border)" strokeWidth="1" />
        ))}
        {area ? <path d={area} fill="url(#devinsight-area)" /> : null}
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover !== null && active ? (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padTop}
              y2={padTop + plotH}
              stroke="var(--accent)"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={x(hover)} cy={y(active.value)} r="3.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
          </>
        ) : null}
      </svg>

      <div className="mt-1 flex justify-between px-1 text-[10px] text-(--muted)">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[n - 1]?.date.slice(5)}</span>
      </div>

      {hover !== null && active ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-(--border) bg-(--surface) px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(x(hover) / W) * 100}%` }}
        >
          <span className="font-semibold text-(--text)">
            {active.value.toLocaleString()}
            {unit}
          </span>
          <span className="ml-1.5 text-(--muted)">{active.date.slice(5)}</span>
        </div>
      ) : null}
    </div>
  );
}
