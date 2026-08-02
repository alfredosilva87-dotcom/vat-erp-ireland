"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { downloadClientPdf } from "@/lib/exportPdf";

type Fmt = "xlsx" | "csv" | "pdf";
type SetKey = "invoices" | "items" | "sales" | "obligations" | "rates" | "accounts";

const SETS: { key: SetKey; label: string; hint: string }[] = [
  { key: "invoices", label: "Notas de entrada", hint: "Compras (T2)" },
  { key: "items", label: "Itens das notas", hint: "Linha a linha" },
  { key: "sales", label: "Vendas", hint: "Faturamento (T1)" },
  { key: "obligations", label: "Apurações", hint: "VAT3 / RTD" },
  { key: "rates", label: "VAT por alíquota", hint: "Resumo fiscal" },
  { key: "accounts", label: "Plano de contas", hint: "Contas contábeis" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Named ranges, so the common cases are one click instead of two date pickers. */
function presetRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (preset) {
    case "today": return { start: iso(now), end: iso(now) };
    case "month": return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m + 1, 0)) };
    case "prev-month": return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return { start: iso(new Date(y, q, 1)), end: iso(new Date(y, q + 3, 0)) };
    }
    default: return { start: `${y}-01-01`, end: `${y}-12-31` };
  }
}

export default function ExportPanel({
  clientId,
  defaultSets = ["invoices", "items", "sales", "obligations", "rates"],
  label = "Exportar",
}: {
  clientId: string;
  defaultSets?: SetKey[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState("year");
  const [range, setRange] = useState(() => presetRange("year"));
  const [sets, setSets] = useState<SetKey[]>(defaultSets);
  const [busy, setBusy] = useState<Fmt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  // The panel is rendered in a portal because the client header card uses
  // `overflow-hidden` (for its rounded sections), which would clip a normally
  // positioned dropdown.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (preset !== "custom") setRange(presetRange(preset));
  }, [preset]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (k: SetKey) =>
    setSets((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const qs = () =>
    `year=${range.start.slice(0, 4)}&start=${range.start}&end=${range.end}&sets=${sets.join(",")}`;

  async function run(fmt: Fmt) {
    if (!sets.length) { setErr("Selecione ao menos um conjunto de dados."); return; }
    if (range.start > range.end) { setErr("A data inicial é posterior à final."); return; }
    setErr(null);
    setBusy(fmt);
    try {
      if (fmt === "pdf") {
        // PDF is laid out in the browser; fetch the same payload the other
        // formats use so all three stay identical.
        const res = await fetch(`/api/clients/${clientId}/export.json?${qs()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Falha ao gerar o PDF.");
        downloadClientPdf(data);
      } else {
        window.location.href = `/api/clients/${clientId}/export.${fmt}?${qs()}`;
      }
      setOpen(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  const panel = (
    <div
      ref={boxRef}
      style={{ position: "fixed", top: pos?.top ?? 0, right: pos?.right ?? 0 }}
      className="z-50 w-[340px] rounded-xl2 border border-line bg-surface p-4 shadow-card"
    >
          <div className="label">Período</div>
          <div className="flex flex-wrap gap-1.5">
            {[
              ["today", "Hoje"], ["month", "Este mês"], ["prev-month", "Mês anterior"],
              ["quarter", "Trimestre"], ["year", "Ano"], ["custom", "Personalizado"],
            ].map(([k, lbl]) => (
              <button
                key={k}
                onClick={() => setPreset(k)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  preset === k ? "bg-brand text-white" : "bg-surface-2 text-muted hover:text-ink"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="label mb-1">De</label>
              <input
                type="date" className="input h-9 text-xs" value={range.start}
                onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, start: e.target.value })); }}
              />
            </div>
            <div>
              <label className="label mb-1">Até</label>
              <input
                type="date" className="input h-9 text-xs" value={range.end}
                onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, end: e.target.value })); }}
              />
            </div>
          </div>

          <div className="label mt-3">Dados a exportar</div>
          <div className="space-y-1">
            {SETS.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2">
                <input
                  type="checkbox" checked={sets.includes(s.key)} onChange={() => toggle(s.key)}
                  className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
                />
                <span className="flex-1 text-sm">{s.label}</span>
                <span className="text-[11px] text-muted">{s.hint}</span>
              </label>
            ))}
          </div>

          {err && <p className="mt-2 text-xs text-danger">{err}</p>}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button className="btn-primary h-9 px-2 text-xs" onClick={() => run("xlsx")} disabled={!!busy}>
              {busy === "xlsx" ? "…" : "Excel"}
            </button>
            <button className="btn-ghost h-9 px-2 text-xs" onClick={() => run("csv")} disabled={!!busy}>
              {busy === "csv" ? "…" : "CSV"}
            </button>
            <button className="btn-ghost h-9 px-2 text-xs" onClick={() => run("pdf")} disabled={!!busy}>
              {busy === "pdf" ? "…" : "PDF"}
            </button>
      </div>
    </div>
  );

  return (
    <>
      <button ref={btnRef} className="btn-ghost h-9 px-3 text-xs" onClick={() => setOpen((v) => !v)}>
        <IconDownload /> {label}
      </button>
      {mounted && open && pos && createPortal(panel, document.body)}
    </>
  );
}

function IconDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4v11m0 0l-4-4m4 4l4-4M4 18v1a2 2 0 002 2h12a2 2 0 002-2v-1"
        stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
