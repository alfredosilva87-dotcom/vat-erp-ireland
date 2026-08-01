"use client";

import { useState } from "react";

export type Slice = { label: string; value: number };

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Series colours, in order. Theme variables so they follow the light/dark toggle.
const TONES = [
  "rgb(var(--c-brand))",
  "rgb(var(--c-success))",
  "rgb(var(--c-violet))",
  "rgb(var(--c-warning))",
  "rgb(var(--c-brand-400))",
  "rgb(var(--c-danger))",
];

/** Donut with a centred total and a side legend showing share of the whole. */
export default function DonutChart({
  data,
  total,
  totalLabel = "Total",
}: {
  data: Slice[];
  total: number;
  totalLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const sum = data.reduce((a, d) => a + d.value, 0);

  const R = 62, r = 42, cx = 80, cy = 80;
  let angle = -Math.PI / 2; // start at 12 o'clock

  const arcs = data.map((d) => {
    const frac = sum > 0 ? d.value / sum : 0;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    // A full-circle single slice can't be drawn with one arc — draw two halves.
    const large = end - start > Math.PI ? 1 : 0;
    const p = (radius: number, a: number) =>
      `${(cx + radius * Math.cos(a)).toFixed(2)},${(cy + radius * Math.sin(a)).toFixed(2)}`;
    const d2 =
      frac >= 0.999
        ? `M ${p(R, start)} A ${R} ${R} 0 1 1 ${p(R, start + Math.PI)} A ${R} ${R} 0 1 1 ${p(R, start)} ` +
          `M ${p(r, start)} A ${r} ${r} 0 1 0 ${p(r, start + Math.PI)} A ${r} ${r} 0 1 0 ${p(r, start)} Z`
        : `M ${p(R, start)} A ${R} ${R} 0 ${large} 1 ${p(R, end)} L ${p(r, end)} A ${r} ${r} 0 ${large} 0 ${p(r, start)} Z`;
    return { d: d2, frac };
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width="160" height="160" viewBox="0 0 160 160" role="img" aria-label={totalLabel}>
        {sum > 0 ? (
          arcs.map((a, i) => (
            <path
              key={i}
              d={a.d}
              fill={TONES[i % TONES.length]}
              opacity={hover === null || hover === i ? 1 : 0.4}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ transition: "opacity .15s" }}
            />
          ))
        ) : (
          <circle cx={cx} cy={cy} r={(R + r) / 2} fill="none" stroke="rgb(var(--c-line))" strokeWidth={R - r} />
        )}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="15" fontWeight="600" fill="rgb(var(--c-ink))">
          € {money(total)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="rgb(var(--c-muted))">
          {totalLabel}
        </text>
      </svg>

      <ul className="min-w-[190px] flex-1 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li
            key={d.label}
            className="flex items-center gap-2"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: TONES[i % TONES.length] }}
            />
            <span className="flex-1 truncate text-muted">{d.label}</span>
            <span className="tnum">€ {money(d.value)}</span>
            <span className="w-12 text-right text-xs tnum text-muted">
              {sum > 0 ? ((d.value / sum) * 100).toFixed(1) : "0.0"}%
            </span>
          </li>
        ))}
        {!data.length && <li className="text-muted">No data in this period.</li>}
      </ul>
    </div>
  );
}
