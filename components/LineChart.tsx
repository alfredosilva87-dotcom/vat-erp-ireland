"use client";

import { useId, useState } from "react";

export type LinePoint = { label: string; a: number; b: number };

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Two-series area/line chart (sales vs purchases). Colours come from the
 * theme's CSS variables so it follows the light/dark toggle.
 */
export default function LineChart({
  data,
  aLabel,
  bLabel,
}: {
  data: LinePoint[];
  aLabel: string;
  bLabel: string;
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b)));
  const W = 720, H = 260, padL = 46, padR = 12, padTop = 14, padBottom = 30;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBottom;
  const step = data.length > 1 ? plotW / (data.length - 1) : 0;

  const x = (i: number) => padL + i * step;
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  const path = (key: "a" | "b") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");
  const area = (key: "a" | "b") =>
    `${path(key)} L${x(data.length - 1).toFixed(1)},${padTop + plotH} L${padL},${padTop + plotH} Z`;

  const axis = (g: number) => {
    const v = max * g;
    return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0);
  };

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${aLabel} vs ${bLabel}`}>
        <defs>
          <linearGradient id={`fa${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-brand))" stopOpacity="0.32" />
            <stop offset="100%" stopColor="rgb(var(--c-brand))" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={`fb${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-success))" stopOpacity="0.26" />
            <stop offset="100%" stopColor="rgb(var(--c-success))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={padL} x2={W - padR}
              y1={padTop + plotH - plotH * g} y2={padTop + plotH - plotH * g}
              stroke="rgb(var(--c-line))" strokeWidth="1"
            />
            <text
              x={padL - 8} y={padTop + plotH - plotH * g + 3}
              textAnchor="end" fontSize="9" fill="rgb(var(--c-muted))"
            >
              {g === 0 ? "0" : axis(g)}
            </text>
          </g>
        ))}

        <path d={area("a")} fill={`url(#fa${gid})`} />
        <path d={area("b")} fill={`url(#fb${gid})`} />
        <path d={path("a")} fill="none" stroke="rgb(var(--c-brand))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={path("b")} fill="none" stroke="rgb(var(--c-success))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {data.map((d, i) => (
          <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={x(i) - step / 2} y={padTop} width={Math.max(step, 8)} height={plotH} fill="transparent" />
            {hover === i && (
              <>
                <line x1={x(i)} x2={x(i)} y1={padTop} y2={padTop + plotH} stroke="rgb(var(--c-brand) / 0.45)" strokeWidth="1" strokeDasharray="3 3" />
                <circle cx={x(i)} cy={y(d.a)} r="4" fill="rgb(var(--c-brand))" stroke="rgb(var(--c-surface))" strokeWidth="2" />
                <circle cx={x(i)} cy={y(d.b)} r="4" fill="rgb(var(--c-success))" stroke="rgb(var(--c-surface))" strokeWidth="2" />
              </>
            )}
            <text
              x={x(i)} y={H - 10} textAnchor="middle" fontSize="10"
              fill={hover === i ? "rgb(var(--c-ink))" : "rgb(var(--c-muted))"}
            >
              {d.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-muted">
            <span className="inline-block h-0.5 w-4 rounded bg-brand" />{aLabel}
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted">
            <span className="inline-block h-0.5 w-4 rounded bg-success" />{bLabel}
          </span>
        </div>
        {hover !== null && (
          <div className="flex flex-wrap items-center gap-3 text-muted">
            <strong className="text-ink">{data[hover].label}</strong>
            <span>{aLabel} € {money(data[hover].a)}</span>
            <span>{bLabel} € {money(data[hover].b)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
