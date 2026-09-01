"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type Conta = { code: string; description: string; type: string; report_group: string };
type Mapa = { external_code: string; external_name: string | null; account_code: string };
type NaoMapeada = { external_code: string; external_name: string; debit: number; credit: number; line: number };
type Previa = {
  read: number; ignored: number; mapped: number;
  unmapped: NaoMapeada[];
  check: { debit: number; credit: number; difference: number; ok: boolean };
  lines: { account_code: string; debit: number; credit: number }[];
  canSave: boolean;
  saved?: boolean; error?: string;
};

/**
 * De-para e carga de saldos de abertura.
 *
 * Sem isto o balanço nunca fecha de verdade: os nossos documentos só têm
 * o MOVIMENTO. O saldo do banco, o capital social, os lucros acumulados
 * e os títulos que já existiam não estão em documento nenhum — e um
 * balanço só com movimento mostra património zero, que é falso.
 *
 * A tela é deliberadamente em duas etapas. O ensaio mostra o que NÃO
 * mapeou e se o balancete do cliente fecha, e só depois se grava.
 * Carregar primeiro e conferir depois é como se põe um erro de três
 * casas no património de um cliente — e o balanço continua a fechar,
 * então ninguém encontra.
 */
export default function OpeningTab({ clientId }: { clientId: string }) {
  const { t } = useT();
  const [contas, setContas] = useState<Conta[]>([]);
  const [mapa, setMapa] = useState<Mapa[]>([]);
  const [texto, setTexto] = useState("");
  const [corte, setCorte] = useState("");
  const [nota, setNota] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [atual, setAtual] = useState<any>(null);
  const [msg, setMsg] = useState<{ texto: string; ok: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const load = useCallback(async () => {
    const [m, o] = await Promise.all([
      fetch(`/api/clients/${clientId}/accounting/mapping`, { cache: "no-store" }).then((r) => r.json()),
      fetch(`/api/clients/${clientId}/accounting/opening`, { cache: "no-store" }).then((r) => r.json()),
    ]);
    setContas(m.accounts || []);
    setMapa(m.mapping || []);
    setAtual(o.opening || null);
    if (o.opening?.cutoff_date) setCorte(o.opening.cutoff_date);
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function salvarMapa(novo: Mapa[]) {
    setMapa(novo);
    await fetch(`/api/clients/${clientId}/accounting/mapping`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapping: novo }),
    });
  }

  async function carregar(dryRun: boolean) {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/accounting/opening`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: texto, cutoffDate: corte, sourceNote: nota, dryRun }),
      });
      const d = await r.json();
      setPrevia(d);
      if (!dryRun && d.saved) {
        setMsg({ texto: t("open.saved"), ok: true });
        await load();
      } else if (!dryRun) {
        setMsg({ texto: d.error || t("open.cannotSave"), ok: false });
      }
      /*
       * As contas que não mapearam entram no de-para já preenchidas, com
       * o destino em branco. É o que transforma "deu erro" em "faltam
       * estas três linhas" — o trabalho fica na frente da pessoa em vez
       * de ela ter de o descobrir.
       */
      if (d.unmapped?.length) {
        const novas = d.unmapped
          .filter((u: NaoMapeada) => !mapa.some((m) => m.external_code === u.external_code))
          .map((u: NaoMapeada) => ({ external_code: u.external_code, external_name: u.external_name, account_code: "" }));
        if (novas.length) setMapa([...mapa, ...novas]);
      }
    } catch (e: any) {
      setMsg({ texto: e.message, ok: false });
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    if (!confirm(t("open.removeConfirm"))) return;
    await fetch(`/api/clients/${clientId}/accounting/opening`, { method: "DELETE" });
    setPrevia(null);
    await load();
    setMsg({ texto: t("open.removed"), ok: true });
  }

  const eur = (v: number) =>
    "€" + v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-5 p-4">
      {atual && (
        <div className="card flex flex-wrap items-center gap-3 border-l-4 border-l-success p-4">
          <span className="chip-ok">{t("open.loaded")}</span>
          <span className="text-sm text-muted">
            {t("open.cutoff")} <b className="font-mono text-ink">{atual.cutoff_date}</b>
            {atual.source_note && ` · ${atual.source_note}`}
          </span>
          <button className="btn-ghost ml-auto h-8 px-3 text-xs text-danger" onClick={remover}>
            {t("open.remove")}
          </button>
        </div>
      )}

      {/* ---------------------------------------------------- de-para */}
      <div>
        <h3 className="font-display text-sm font-semibold">{t("open.mappingTitle")}</h3>
        <p className="mt-0.5 text-xs text-muted">{t("open.mappingHelp")}</p>
        <div className="mt-2 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2 font-medium">{t("open.colExternal")}</th>
                <th className="px-3 py-2 font-medium">{t("open.colExternalName")}</th>
                <th className="px-3 py-2 font-medium">{t("open.colOurs")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {mapa.map((m, i) => (
                <tr key={i} className="border-b border-line/60">
                  <td className="px-3 py-1.5">
                    <input className="input h-8 w-28 font-mono text-xs" value={m.external_code}
                      onChange={(e) => { const n = [...mapa]; n[i] = { ...m, external_code: e.target.value }; setMapa(n); }} />
                  </td>
                  <td className="px-3 py-1.5">
                    <input className="input h-8 text-xs" value={m.external_name ?? ""}
                      onChange={(e) => { const n = [...mapa]; n[i] = { ...m, external_name: e.target.value }; setMapa(n); }} />
                  </td>
                  <td className="px-3 py-1.5">
                    <select className="input h-8 text-xs" value={m.account_code}
                      onChange={(e) => { const n = [...mapa]; n[i] = { ...m, account_code: e.target.value }; salvarMapa(n); }}>
                      <option value="">{t("open.choose")}</option>
                      {contas.map((c) => (
                        <option key={c.code} value={c.code}>{c.code} · {c.description}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button className="btn-ghost h-7 px-2 text-xs text-danger"
                      onClick={() => salvarMapa(mapa.filter((_, j) => j !== i))}>×</button>
                  </td>
                </tr>
              ))}
              {!mapa.length && (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted">{t("open.mappingEmpty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-ghost h-8 px-3 text-xs"
            onClick={() => setMapa([...mapa, { external_code: "", external_name: "", account_code: "" }])}>
            + {t("open.addRow")}
          </button>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => salvarMapa(mapa)}>
            {t("common.save")}
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------ carga */}
      <div className="border-t border-line pt-5">
        <h3 className="font-display text-sm font-semibold">{t("open.loadTitle")}</h3>
        <p className="mt-0.5 text-xs text-muted">{t("open.loadHelp")}</p>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">{t("open.cutoff")}</label>
            <input type="date" className="input w-auto" value={corte} onChange={(e) => setCorte(e.target.value)} />
          </div>
          <div className="min-w-[16rem] flex-1">
            <label className="label">{t("open.sourceNote")}</label>
            <input className="input" placeholder={t("open.sourcePlaceholder")}
              value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        </div>

        <textarea
          className="input mt-3 h-40 font-mono text-xs"
          placeholder={t("open.pastePlaceholder")}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => carregar(true)} disabled={ocupado || !texto.trim() || !corte}>
            {t("open.preview")}
          </button>
          <button className="btn-primary" onClick={() => carregar(false)}
            disabled={ocupado || !previa?.canSave}>
            {atual ? t("open.reload") : t("open.save")}
          </button>
          {msg && <span className={`text-sm ${msg.ok ? "text-muted" : "text-danger"}`}>{msg.texto}</span>}
        </div>
      </div>

      {/* ------------------------------------------------------ prévia */}
      {previa && (
        <div className="border-t border-line pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`chip ${previa.check.ok ? "chip-ok" : "chip-danger"}`}>
              {previa.check.ok ? t("open.sheetBalances") : t("open.sheetDoesNot")}
            </span>
            <span className="text-sm text-muted">
              {t("open.readLines", { n: previa.read, ign: previa.ignored })}
              {" · "}
              {t("open.colDebit")} <b className="font-mono text-ink">{eur(previa.check.debit)}</b>
              {" / "}
              {t("open.colCredit")} <b className="font-mono text-ink">{eur(previa.check.credit)}</b>
              {!previa.check.ok && (
                <b className="ml-2 text-danger">{t("acc.difference")}: {eur(previa.check.difference)}</b>
              )}
            </span>
          </div>

          {!!previa.unmapped.length && (
            <div className="mt-3">
              <p className="text-sm font-semibold text-danger">
                {t("open.unmappedTitle", { n: previa.unmapped.length })}
              </p>
              <p className="text-xs text-muted">{t("open.unmappedHelp")}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {previa.unmapped.map((u) => (
                  <li key={u.external_code} className="font-mono">
                    {u.external_code} · {u.external_name} —{" "}
                    {u.debit ? `${t("open.colDebit")} ${eur(u.debit)}` : `${t("open.colCredit")} ${eur(u.credit)}`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!previa.lines.length && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-2 font-medium">{t("acc.colAccount")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("open.colDebit")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("open.colCredit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.lines.map((l) => (
                    <tr key={l.account_code} className="border-b border-line/60">
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {l.account_code} · {contas.find((c) => c.code === l.account_code)?.description ?? ""}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.debit ? eur(l.debit) : ""}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.credit ? eur(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
