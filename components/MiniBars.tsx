"use client";

type Point = { month: string; gross: number; credit: number };

export default function MiniBars({ data }: { data: Point[] }) {
  const max = Math.max(1, ...data.map((d) => d.gross));
  const W = 640, H = 200, pad = 28, bw = (W - pad * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly entries">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line key={g} x1={pad} x2={W - pad} y1={H - pad - (H - pad * 2) * g} y2={H - pad - (H - pad * 2) * g}
          stroke="#E4E8F1" strokeWidth="1" />
      ))}
      {data.map((d, i) => {
        const h = (d.gross / max) * (H - pad * 2);
        const x = pad + i * bw + bw * 0.2;
        const w = bw * 0.6;
        const y = H - pad - h;
        const ch = (d.credit / max) * (H - pad * 2);
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={Math.max(0, h)} rx="3" fill="#2563EB" opacity="0.9">
              <title>{d.month}: gross €{d.gross.toFixed(2)}, credit €{d.credit.toFixed(2)}</title>
            </rect>
            <rect x={x} y={H - pad - ch} width={w} height={Math.max(0, ch)} rx="3" fill="#159A6B" opacity="0.85" />
            <text x={x + w / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#606B84">{d.month}</text>
          </g>
        );
      })}
    </svg>
  );
}
