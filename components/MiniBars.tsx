"use client";

import { useId, useState } from "react";

export type SeriesPoint = {
  month: string;
  gross: number;   // purchases in (gross)
  credit: number;  // input VAT credit earned on those purchases
  sales: number;   // sales out (gross)
  salesVat?: number;
  count: number;
};

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Grouped monthly bars: purchases vs sales, with the input credit drawn as a
 * lighter overlay inside the purchases bar. Colours come from the theme's CSS
 * variables so the chart follows the light/dark toggle.
 */
export default function MiniBars({ data }: { data: SeriesPoint[] }) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(1, ...data.map((d) => Math.max(d.gross, d.sales)));
  const W = 720, H = 240, padX = 38, padTop = 16, padBottom = 34;
  const plotH = H - padTop - padBottom;
  const slot = (W - padX * 2) / data.length;
  const barW = Math.min(16, slot * 0.3);
  const gap = 3;

  const y = (v: number) => padTop + plotH - (v / max) * plotH;
  const axisLabel = (g: number) => {
    const v = max * g;
    if (v === 0) return "0";
    return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0);
  };

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly purchases and sales">
        <defs>
          <linearGradient id={`buy${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-brand-400))" />
            <stop offset="100%" stopColor="rgb(var(--c-brand-600))" />
          </linearGradient>
          <linearGradient id={`sell${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-success))" stopOpacity="0.9" />
            <stop offset="100%" stopColor="rgb(var(--c-success))" stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {/* gridlines + value axis */}
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line
              x1={padX} x2={W - padX / 2}
              y1={padTop + plotH - plotH * g} y2={padTop + plotH - plotH * g}
              stroke="rgb(var(--c-line))" strokeWidth="1"
            />
            <text
              x={padX - 6} y={padTop + plotH - plotH * g + 3}
              textAnchor="end" fontSize="9" fill="rgb(var(--c-muted))"
            >
              {axisLabel(g)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const cx = padX + i * slot + slot / 2;
          const xBuy = cx - barW - gap / 2;
          const xSell = cx + gap / 2;
          const hBuy = Math.max(0, padTop + plotH - y(d.gross));
          const hSell = Math.max(0, padTop + plotH - y(d.sales));
          const hCredit = Math.max(0, (d.credit / max) * plotH);
          const on = hover === i;

          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* hover band */}
              <rect
                x={cx - slot / 2} y={padTop} width={slot} height={plotH}
                fill={on ? "rgb(var(--c-brand) / 0.10)" : "transparent"}
              />
              {/* purchases */}
              <rect x={xBuy} y={y(d.gross)} width={barW} height={hBuy} rx="3" fill={`url(#buy${gid})`} />
              {/* input credit, stacked at the base of the purchases bar */}
              {hCredit > 0 && (
                <rect
                  x={xBuy} y={padTop + plotH - hCredit} width={barW} height={hCredit}
                  rx="3" fill="rgb(var(--c-success))" opacity="0.9"
                />
              )}
              {/* sales */}
              <rect x={xSell} y={y(d.sales)} width={barW} height={hSell} rx="3" fill={`url(#sell${gid})`} />

              <text
                x={cx} y={H - 12} textAnchor="middle" fontSize="10"
                fill={on ? "rgb(var(--c-ink))" : "rgb(var(--c-muted))"}
              >
                {d.month}
              </text>
            </g>
          );
        })}
      </svg>

      {/* legend + hovered month detail */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <Key className="bg-brand" label="Purchases in (gross)" />
          <Key className="bg-success" label="Input credit" />
          <Key className="bg-success/60" label="Sales out (gross)" />
        </div>
        {hover !== null && (
          <div className="flex flex-wrap items-center gap-3 text-muted">
            <strong className="text-ink">{data[hover].month}</strong>
            <span>In € {money(data[hover].gross)}</span>
            <span>Out € {money(data[hover].sales)}</span>
            <span className="text-brand-700">Credit € {money(data[hover].credit)}</span>
            <span>{data[hover].count} inv.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}
