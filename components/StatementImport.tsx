"use client";

/**
 * Importing a bank statement into one account.
 *
 * The whole point of this screen is that **no bank format is programmed**. The
 * file is read locally, a starting mapping is guessed, and the accountant
 * confirms it once — from then on that mapping is the account's, and the same
 * bank imports with no questions asked.
 *
 * Everything is re-parsed in the browser on every change, so changing a column
 * shows the corrected preview immediately. Nothing is written until Save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileToRows } from "@/lib/sheet";
import {
  detectLayout, buildLines, checkAgainstBalance,
  type ColumnMapping, type StatementLine, type ParseProblem,
} from "@/lib/bankStatement";

const money = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Counts = { newCount: number; duplicateCount: number; duplicatePeriod: { from: string; to: string } | null };

const FIELDS: { key: keyof ColumnMapping; label: string; when?: "signed" | "debit_credit" }[] = [
  { key: "date", label: "Data" },
  { key: "description", label: "Descrição" },
  { key: "amount", label: "Valor", when: "signed" },
  { key: "debit", label: "Saída (débito)", when: "debit_credit" },
  { key: "credit", label: "Entrada (crédito)", when: "debit_credit" },
  { key: "balance", label: "Saldo" },
  { key: "reference", label: "Referência" },
  { key: "payee", label: "Beneficiário" },
];

export default function StatementImport({
  clientId, accountId, savedMapping, onImported,
}: {
  clientId: string;
  accountId: string;
  savedMapping: ColumnMapping | null;
  onImported: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [format, setFormat] = useState("csv");
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [usedSaved, setUsedSaved] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!rows || !mapping) return null;
    const { lines, problems, summaryRows } = buildLines(rows, mapping);
    return { lines, problems, summaryRows, balanceWarning: checkAgainstBalance(lines) };
  }, [rows, mapping]);

  /**
   * PDF é lido no servidor (a biblioteca de PDF é de Node) e volta como a mesma
   * grade de células que um CSV produz — daí para a frente, o caminho é o
   * mesmo: confirmar o mapeamento e conferir antes de gravar.
   */
  async function pdfToRows(
    file: File
  ): Promise<{ rows: unknown[][]; notes: string[]; signFromBalance: boolean } | null> {
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`/api/clients/${clientId}/bank-accounts/${accountId}/import/pdf`, {
      method: "POST", body,
    });
    const d = await res.json();
    if (!res.ok) { setError(d.error || "Não consegui ler este PDF."); return null; }
    return { rows: d.rows || [], notes: d.notes || [], signFromBalance: !!d.signFromBalance };
  }

  async function onFile(file: File) {
    setError(null); setCounts(null); setBusy(true);
    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf");
      let aoa: unknown[][];
      let fmt: string;
      let extraNotes: string[] = [];
      let pdfResolved = false;

      if (isPdf) {
        const parsed = await pdfToRows(file);
        if (!parsed) return;
        aoa = parsed.rows;
        fmt = "pdf";
        extraNotes = parsed.notes;
        pdfResolved = parsed.signFromBalance;
      } else {
        const r = await fileToRows(file);
        aoa = r.rows;
        fmt = r.format;
      }

      if (!aoa.length) { setError("Não encontrei nenhuma linha neste arquivo."); return; }
      setRows(aoa); setFilename(file.name); setFormat(fmt);

      if (isPdf) {
        // Mapeamento salvo vem de planilha e não descreve o que sai de um PDF;
        // reusá-lo aqui apontaria colunas para o lugar errado.
        //
        // Quando o servidor resolveu o sinal pelo saldo corrido, a forma é
        // conhecida — [data, descrição, valor, saldo] — e vale dizer isso em
        // vez de deixar adivinhar. Sem apontar a coluna de saldo, a conferência
        // contra o saldo do próprio extrato não roda, e é justamente no PDF que
        // ela mais vale.
        const detected = detectLayout(aoa);
        setMapping(pdfResolved
          ? {
              headerRow: null, date: 0, description: 1, reference: null, payee: null,
              amount: 2, debit: null, credit: null, balance: 3,
              amountStyle: "signed", dateStyle: "ymd", invertSign: false,
            }
          : detected.mapping);
        setUsedSaved(false);
        setNotes([...extraNotes, ...(pdfResolved ? [] : detected.notes)]);
        return;
      }

      // A saved mapping is the whole payoff of the first import: the second
      // statement from the same bank should need no confirmation at all. It is
      // only trusted while it still fits — a bank that changes its export
      // falls back to detection instead of silently reading the wrong columns.
      const detected = detectLayout(aoa);
      const fits = savedMapping && mappingFits(aoa, savedMapping);
      setMapping(fits ? savedMapping! : detected.mapping);
      setUsedSaved(!!fits);
      setNotes(fits ? ["Usando o mapeamento salvo desta conta."] : detected.notes);
    } catch (e: any) {
      setError("Não consegui ler o arquivo: " + (e?.message || "erro desconhecido"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // How much of this file the account already has. Asked again on every
  // mapping change, because a different column changes every dedupe key.
  const checkDuplicates = useCallback(async (lines: StatementLine[]) => {
    if (!lines.length) { setCounts(null); return; }
    try {
      const res = await fetch(`/api/clients/${clientId}/bank-accounts/${accountId}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true, lines }),
      });
      const d = await res.json();
      if (res.ok) setCounts(d);
    } catch { /* preview only — the save path reports for real */ }
  }, [clientId, accountId]);

  useEffect(() => {
    if (!parsed) return;
    const t = setTimeout(() => checkDuplicates(parsed.lines), 350);
    return () => clearTimeout(t);
  }, [parsed, checkDuplicates]);

  async function save() {
    if (!parsed || !mapping) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/bank-accounts/${accountId}/import`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: parsed.lines, mapping, filename, format }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "Não foi possível importar."); return; }
      reset();
      onImported(
        `${d.imported} linha(s) importada(s)` +
        (d.skipped ? `, ${d.skipped} já existiam e foram ignoradas` : "") +
        (d.rejected ? `, ${d.rejected} recusada(s) por dado inválido` : "") + "."
      );
    } finally { setBusy(false); }
  }

  function reset() {
    setRows(null); setMapping(null); setCounts(null); setNotes([]); setFilename("");
  }

  const columns = useMemo(() => columnLabels(rows, mapping), [rows, mapping]);

  if (!rows || !mapping) {
    return (
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Importar extrato</h2>
            <p className="mt-1 text-sm text-muted">
              Excel, CSV ou PDF. As colunas são detectadas e você confirma antes de gravar
              {savedMapping ? " — esta conta já tem um mapeamento salvo, então normalmente é só conferir." : "."}
            </p>
            <p className="mt-1 text-xs text-muted">
              Se o banco oferecer CSV ou Excel, prefira: PDF é reconstruído a partir do texto e dá mais trabalho de conferir.
            </p>
          </div>
          <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "Lendo…" : "Escolher arquivo"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt,.pdf" className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const lines = parsed?.lines ?? [];

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Conferir antes de gravar</h2>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono">{filename}</span> · {lines.length} linha(s) reconhecida(s)
            {usedSaved && " · mapeamento salvo"}
          </p>
        </div>
        <button className="btn-ghost" onClick={reset}>Cancelar</button>
      </div>

      {/* Mapping — this is what gets saved on the account */}
      <div className="rounded-xl border border-line bg-surface-2/40 p-4">
        <p className="label mb-3">Mapeamento das colunas</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Formato do valor">
            <select className="input h-9" value={mapping.amountStyle}
              onChange={(e) => setMapping({ ...mapping, amountStyle: e.target.value as any })}>
              <option value="signed">Uma coluna com sinal</option>
              <option value="debit_credit">Entrada e saída separadas</option>
            </select>
          </Field>
          <Field label="Formato da data">
            <select className="input h-9" value={mapping.dateStyle}
              onChange={(e) => setMapping({ ...mapping, dateStyle: e.target.value as any })}>
              <option value="dmy">Dia/mês/ano</option>
              <option value="mdy">Mês/dia/ano</option>
              <option value="ymd">Ano-mês-dia</option>
            </select>
          </Field>
          <Field label="Linha do cabeçalho">
            <select className="input h-9" value={mapping.headerRow === null ? "none" : String(mapping.headerRow)}
              onChange={(e) => setMapping({ ...mapping, headerRow: e.target.value === "none" ? null : Number(e.target.value) })}>
              <option value="none">Sem cabeçalho</option>
              {rows.slice(0, 25).map((_, i) => <option key={i} value={i}>Linha {i + 1}</option>)}
            </select>
          </Field>
          {mapping.amountStyle === "signed" && (
            <Field label="Sinal">
              <select className="input h-9" value={mapping.invertSign ? "invert" : "normal"}
                onChange={(e) => setMapping({ ...mapping, invertSign: e.target.value === "invert" })}>
                <option value="normal">Negativo = saída</option>
                <option value="invert">Inverter (positivo = saída)</option>
              </select>
            </Field>
          )}
          {FIELDS.filter((f) => !f.when || f.when === mapping.amountStyle).map((f) => (
            <Field key={String(f.key)} label={f.label}>
              <select className="input h-9"
                value={mapping[f.key] === null || mapping[f.key] === undefined ? "none" : String(mapping[f.key])}
                onChange={(e) => setMapping({
                  ...mapping,
                  [f.key]: e.target.value === "none" ? (f.key === "date" ? 0 : null) : Number(e.target.value),
                } as ColumnMapping)}>
                <option value="none">— nenhuma —</option>
                {columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
              </select>
            </Field>
          ))}
        </div>
      </div>

      {/* What the file is telling us */}
      <div className="space-y-2 text-sm">
        {notes.map((n, i) => <p key={i} className="text-muted">· {n}</p>)}
        {parsed?.balanceWarning && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-danger">⚠ {parsed.balanceWarning}</p>
        )}
        {!!parsed?.summaryRows.length && (
          <p className="text-muted">
            {parsed.summaryRows.length} linha(s) de totalização ignorada(s) (linhas {parsed.summaryRows.join(", ")}).
          </p>
        )}
        {!!parsed?.problems.length && (
          <details className="rounded-lg bg-surface-2/60 px-3 py-2">
            <summary className="cursor-pointer text-danger">
              {parsed.problems.length} linha(s) não reconhecida(s) — não serão importadas
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {parsed.problems.slice(0, 20).map((p: ParseProblem, i) => (
                <li key={i}>Linha {p.row}: {p.reason}</li>
              ))}
            </ul>
          </details>
        )}
        {counts && (
          <p className={counts.duplicateCount ? "rounded-lg bg-brand/10 px-3 py-2" : "text-muted"}>
            <strong className="tnum">{counts.newCount}</strong> nova(s)
            {counts.duplicateCount > 0 && (
              <> · <strong className="tnum">{counts.duplicateCount}</strong> já importada(s)
                {counts.duplicatePeriod && ` (${counts.duplicatePeriod.from} a ${counts.duplicatePeriod.to})`}
                {" "}— serão ignoradas, não duplicadas
              </>
            )}
          </p>
        )}
      </div>

      {/* Preview */}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Descrição</th>
              <th className="px-3 py-2 font-medium text-right">Valor €</th>
              <th className="px-3 py-2 font-medium text-right">Saldo €</th>
            </tr>
          </thead>
          <tbody>
            {lines.slice(0, 15).map((l, i) => (
              <tr key={i} className="border-b border-line/60">
                <td className="px-3 py-1.5 tnum">{l.line_date}</td>
                <td className="px-3 py-1.5">{l.description || "—"}</td>
                <td className={`px-3 py-1.5 text-right tnum ${l.amount < 0 ? "text-danger" : "text-brand-700"}`}>
                  {money(l.amount)}
                </td>
                <td className="px-3 py-1.5 text-right tnum text-muted">
                  {l.balance === null ? "—" : money(l.balance)}
                </td>
              </tr>
            ))}
            {!lines.length && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-muted">
                Nenhuma linha reconhecida com este mapeamento. Confira as colunas acima.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      {lines.length > 15 && (
        <p className="text-xs text-muted">Mostrando as 15 primeiras de {lines.length}.</p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={busy || !lines.length}>
          {busy ? "Gravando…" : `Importar ${counts ? counts.newCount : lines.length} linha(s)`}
        </button>
        <span className="text-xs text-muted">
          O mapeamento acima fica salvo nesta conta e será reusado na próxima importação.
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Column names from the header row, falling back to positions. */
function columnLabels(rows: unknown[][] | null, mapping: ColumnMapping | null): string[] {
  if (!rows) return [];
  const width = rows.reduce((m, r) => Math.max(m, (r || []).length), 0);
  const header = mapping?.headerRow !== null && mapping?.headerRow !== undefined ? rows[mapping.headerRow] : null;
  return Array.from({ length: width }, (_, i) => {
    const name = String(header?.[i] ?? "").trim();
    return name ? `${i + 1}. ${name}` : `Coluna ${i + 1}`;
  });
}

/**
 * Whether a mapping saved earlier still makes sense for this file. A bank that
 * adds a column would otherwise shift everything by one and import silently
 * wrong — the expensive kind of mistake, because it looks like it worked.
 */
function mappingFits(rows: unknown[][], m: ColumnMapping): boolean {
  const width = rows.reduce((w, r) => Math.max(w, (r || []).length), 0);
  const used = [m.date, m.amount, m.debit, m.credit, m.balance, m.description]
    .filter((c): c is number => c !== null && c !== undefined);
  if (used.some((c) => c >= width)) return false;
  const { lines, problems } = buildLines(rows, m);
  return lines.length > 0 && problems.length <= lines.length * 0.2;
}
