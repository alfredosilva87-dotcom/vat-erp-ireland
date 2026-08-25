"use client";

import { useCallback, useEffect, useState } from "react";
import type { ContaBanco, Encargo, Baixa, Partida, Titulo } from "@/components/financial/tipos";
import { ENCARGOS, ORIGEM, eur } from "@/components/financial/tipos";
import { useT, type TKey } from "@/lib/i18n";

/** O detalhe: conta contábil, vencimento, encargos e as baixas. */
export default function PainelDoTitulo({
  clientId, titleId, contraparte, aoFechar, aoMudar,
}: {
  clientId: string; titleId: string; contraparte: string;
  aoFechar: () => void; aoMudar: () => void;
}) {
  // `t` já é o título aqui; o tradutor entra como `tr` para não colidir.
  const { t: tr } = useT();
  const [d, setD] = useState<{
    title: Titulo; charges: Encargo[]; settlements: Baixa[];
    bankAccounts: ContaBanco[]; entries: Partida[];
  } | null>(null);
  const [contaBanco, setContaBanco] = useState("");
  const [dataBaixa, setDataBaixa] = useState(() => new Date().toISOString().slice(0, 10));
  const [valorBaixa, setValorBaixa] = useState("");
  const [conta, setConta] = useState("");
  const [venc, setVenc] = useState("");
  const [tipo, setTipo] = useState("interest");
  const [valor, setValor] = useState("");
  const [desc, setDesc] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/clients/${clientId}/titles/${titleId}`, { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setD(j);
    setConta(j.title.account_code || "");
    setVenc(j.title.due_date || "");
    // A baixa nasce preenchida com o que falta pagar e a primeira conta: o
    // caso comum é pagar tudo, e obrigar a digitar o valor que está no ecrã
    // logo acima é pedir para errar.
    setValorBaixa(Number(j.title.outstanding_amount || 0).toFixed(2));
    setContaBanco((atual) => atual || j.bankAccounts?.[0]?.id || "");
  }, [clientId, titleId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function gravarTitulo() {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/titles/${titleId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_code: conta, due_date: venc }),
      });
      if (!r.ok) throw new Error((await r.json()).error || tr("ttl.saveFailed"));
      await carregar(); aoMudar();
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  }

  async function acrescentar() {
    setOcupado(true); setErro(null);
    try {
      const n = Number(String(valor).replace(",", "."));
      const r = await fetch(`/api/clients/${clientId}/titles/${titleId}/charges`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Sem `account_code`: a conta é decidida no servidor, pelo tipo e pelo
        // lado do título. Ver a rota de encargos.
        body: JSON.stringify({ kind: tipo, amount: n, description: desc }),
      });
      if (!r.ok) throw new Error((await r.json()).error || tr("ttl.saveFailed"));
      setValor(""); setDesc("");
      await carregar(); aoMudar();
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  }

  async function darBaixa() {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/titles/${titleId}/settle`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_account_id: contaBanco, settled_on: dataBaixa,
          amount: Number(String(valorBaixa).replace(",", ".")),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || tr("ttl.settleFailed"));
      await carregar(); aoMudar();
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  }

  async function desfazerBaixa(id: string) {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/titles/${titleId}/settle?settlement=${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error || tr("ttl.undoFailed"));
      await carregar(); aoMudar();
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  }

  async function remover(chargeId: string) {
    await fetch(`/api/clients/${clientId}/titles/${titleId}/charges?charge=${chargeId}`, { method: "DELETE" });
    await carregar(); aoMudar();
  }

  const t = d?.title;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-end bg-black/35" onClick={aoFechar}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold">
              {t?.document_ref || tr("ttl.fallbackRef")}
            </h2>
            <p className="text-sm text-muted">{contraparte}: {t?.counterparty || "—"}</p>
          </div>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={aoFechar}>{tr("ttl.close")}</button>
        </div>

        {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

        {t && (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-line bg-surface-2/50 p-3">
                <div className="text-[10.5px] uppercase tracking-wide text-muted">{tr("ttl.original")}</div>
                <div className="font-mono text-lg font-semibold tabular-nums">{eur(t.original_amount)}</div>
              </div>
              <div className="rounded-xl border border-line bg-surface-2/50 p-3">
                <div className="text-[10.5px] uppercase tracking-wide text-muted">{tr("ttl.outstanding")}</div>
                <div className="font-mono text-lg font-semibold tabular-nums">{eur(t.outstanding_amount)}</div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="flex flex-col leading-tight">
                <span className="label">{tr("ttl.account")}</span>
                {/* O padrão depende do LADO: fornecedores a pagar, clientes a
                    receber. O placeholder fixo em 2100 induzia ao erro num
                    título a receber. */}
                <input className="input w-full font-mono text-[13px]"
                  placeholder={tr(t.kind === "payable" ? "ttl.accountPlaceholderPayable" : "ttl.accountPlaceholderReceivable")}
                  value={conta} onChange={(e) => setConta(e.target.value)} />
              </label>
              <label className="flex flex-col leading-tight">
                <span className="label">{tr("ttl.dueDate")}</span>
                <input type="date" className="input w-full text-[13px]" value={venc}
                  onChange={(e) => setVenc(e.target.value)} />
              </label>
              <button className="btn-primary h-10 px-4 text-sm" disabled={ocupado} onClick={gravarTitulo}>
                {tr("ttl.save")}
              </button>
            </div>
            {/* O valor original não se edita: diferença entra como encargo, onde
                fica visível o quanto e porquê. */}
            <p className="mt-1 text-xs text-muted">
              {tr("ttl.originalLocked")}
            </p>

            <h3 className="mt-6 font-display text-sm font-semibold">{tr("ttl.chargesHeading")}</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-[110px_110px_1fr_auto] sm:items-end">
              <label className="flex flex-col leading-tight">
                <span className="label">{tr("ttl.chargeKind")}</span>
                <select className="input w-full text-[13px]" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  {ENCARGOS.map((e) => <option key={e.v} value={e.v}>{tr(e.r as TKey)}</option>)}
                </select>
              </label>
              <label className="flex flex-col leading-tight">
                <span className="label">{tr("ttl.amount")}</span>
                <input className="input w-full text-right font-mono text-[13px]" value={valor}
                  onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
              </label>
              <label className="flex flex-col leading-tight">
                <span className="label">{tr("ttl.description")}</span>
                <input className="input w-full text-[13px]" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </label>
              <button className="btn-ghost h-10 px-4 text-sm" disabled={ocupado || !valor} onClick={acrescentar}>
                {tr("ttl.add")}
              </button>
            </div>

            {d.charges.length > 0 && (
              <table className="mt-3 w-full text-[13px]">
                <tbody>
                  {d.charges.map((c) => (
                    <tr key={c.id} className="border-b border-line/50">
                      <td className="py-1.5 font-mono text-[12px] text-muted">{c.incurred_on}</td>
                      <td className="py-1.5">{(() => { const k = ENCARGOS.find((e) => e.v === c.kind)?.r; return k ? tr(k as TKey) : c.kind; })()}</td>
                      <td className="py-1.5 text-muted">{c.description || ""}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">
                        {c.kind === "discount" ? "−" : ""}{eur(c.amount)}
                      </td>
                      <td className="py-1.5 text-right">
                        <button className="btn-ghost h-6 px-2 text-[11px]" onClick={() => remover(c.id)}>
                          {tr("ttl.remove")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 className="mt-6 font-display text-sm font-semibold">
              {tr(t.kind === "payable" ? "ttl.settleHeadingPayable" : "ttl.settleHeadingReceivable")}
            </h3>
            {d.bankAccounts.length === 0 ? (
              <p className="mt-1 text-sm text-muted">
                {tr("ttl.noBankAccount")}
              </p>
            ) : Number(t.outstanding_amount) <= 0 ? (
              <p className="mt-1 text-sm text-muted">{tr("ttl.alreadySettled")}</p>
            ) : (
              <>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_120px_120px_auto] sm:items-end">
                  <label className="flex flex-col leading-tight">
                    <span className="label">{tr("ttl.bankAccount")}</span>
                    <select className="input w-full text-[13px]" value={contaBanco}
                      onChange={(e) => setContaBanco(e.target.value)}>
                      {d.bankAccounts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.bank_name ? ` — ${c.bank_name}` : ""}
                          {c.account_code ? ` (${c.account_code})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col leading-tight">
                    <span className="label">{tr("ttl.date")}</span>
                    <input type="date" className="input w-full text-[13px]" value={dataBaixa}
                      onChange={(e) => setDataBaixa(e.target.value)} />
                  </label>
                  <label className="flex flex-col leading-tight">
                    <span className="label">{tr("ttl.amount")}</span>
                    <input className="input w-full text-right font-mono text-[13px]" value={valorBaixa}
                      onChange={(e) => setValorBaixa(e.target.value)} />
                  </label>
                  <button className="btn-primary h-10 px-4 text-sm" disabled={ocupado || !contaBanco || !valorBaixa}
                    onClick={darBaixa}>
                    {tr(t.kind === "payable" ? "ttl.pay" : "ttl.receive")}
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {tr("ttl.settleHelp")}
                </p>
              </>
            )}

            <h3 className="mt-6 font-display text-sm font-semibold">{tr("ttl.settlementsHeading")}</h3>
            {d.settlements.length === 0 ? (
              <p className="mt-1 text-sm text-muted">{tr("ttl.noSettlements")}</p>
            ) : (
              <table className="mt-2 w-full text-[13px]">
                <tbody>
                  {d.settlements.map((s) => (
                    <tr key={s.id} className="border-b border-line/50">
                      <td className="py-1.5 font-mono text-[12px] text-muted">{s.settled_on}</td>
                      <td className="py-1.5 text-muted">
                        {tr(s.bank_transaction_id ? "ttl.byBank" : "ttl.manual")}
                        {!s.journal_id && <span className="ml-1 text-warning">{tr("ttl.noEntry")}</span>}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{eur(s.amount)}</td>
                      <td className="py-1.5 text-right">
                        <button className="btn-ghost h-6 px-2 text-[11px]" disabled={ocupado}
                          onClick={() => desfazerBaixa(s.id)}>{tr("ttl.undo")}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/*
              As contrapartidas. Estavam gravadas desde sempre e não havia por
              onde chegar até elas a partir do título — era preciso ir ao razão
              e procurar. "Onde grava os lançamentos contábeis?" é aqui.
            */}
            <h3 className="mt-6 font-display text-sm font-semibold">{tr("ttl.entriesHeading")}</h3>
            {d.entries.length === 0 ? (
              <p className="mt-1 text-sm text-muted">
                {tr("ttl.noEntries")}
              </p>
            ) : (
              <table className="mt-2 w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="py-1 text-left font-medium">{tr("ttl.date")}</th>
                    <th className="py-1 text-left font-medium">{tr("ttl.colOrigin")}</th>
                    <th className="py-1 text-left font-medium">{tr("ttl.colAccount")}</th>
                    <th className="py-1 text-right font-medium">{tr("ttl.colDebit")}</th>
                    <th className="py-1 text-right font-medium">{tr("ttl.colCredit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.entries.map((l) => (
                    <tr key={l.id} className="border-b border-line/40">
                      <td className="py-1.5 font-mono text-[11.5px] text-muted">{l.date || "—"}</td>
                      <td className="py-1.5 text-muted">{ORIGEM[l.origin ?? ""] ? tr(ORIGEM[l.origin ?? ""] as TKey) : l.origin}</td>
                      <td className="py-1.5">
                        <span className="font-mono text-[11.5px] text-muted">{l.accountCode}</span>{" "}
                        {l.accountName}
                      </td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{l.debit ? eur(l.debit) : ""}</td>
                      <td className="py-1.5 text-right font-mono tabular-nums">{l.credit ? eur(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
