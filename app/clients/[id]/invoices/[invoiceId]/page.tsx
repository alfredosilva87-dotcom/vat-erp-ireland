"use client";

/**
 * O editor da fatura: montar, emitir e enviar.
 *
 * ---------------------------------------------------------------------------
 * A LINHA QUE ESTA TELA NÃO DEIXA ATRAVESSAR SEM QUERER
 *
 * Emitir não é gravar. Gravar é reversível e não custa nada; emitir consome um
 * número da sequência, cria a venda, entra no VAT e abre título a receber — e
 * daí em diante a fatura já não se edita, anula-se.
 *
 * Por isso "Gravar" é discreto e "Emitir" pede confirmação a dizer o que vai
 * acontecer. Um botão só, ou dois iguais, faria a diferença desaparecer
 * justamente para quem a está a usar pela primeira vez.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { calcularInvoice, vencimentoDosTermos, porDentro } from "@/lib/invoicing/calculo";
import { linkDeWhatsapp } from "@/lib/invoicing/envioPuro";

type Item = {
  description: string; detail: string; quantity: number; unitPrice: number; vatRate: number;
};
type Cliente = {
  id: string; name: string; vatNumber: string | null; email: string | null;
  phone: string | null; address: string | null; shipAddress: string | null;
};
type Invoice = {
  id: string; number: string; status: "draft" | "issued" | "sent" | "cancelled";
  customerId: string | null; customerName: string; customerVat: string | null;
  customerAddr: string | null; customerShip: string | null; customerEmail: string | null;
  issueDate: string; dueDate: string | null; paymentTerms: string | null;
  customerRef: string | null; notes: string | null;
  net: number; vat: number; gross: number; sentAt: string | null; sentTo: string | null;
  items: (Item & { id: string })[];
};

const eur = (n: number) =>
  n.toLocaleString("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });

const LINHA_VAZIA: Item = { description: "", detail: "", quantity: 1, unitPrice: 0, vatRate: 23 };
/** As alíquotas irlandesas em vigor, mais a isenta. */
const TAXAS = [0, 4.8, 9, 13.5, 23];

export default function InvoiceEditor({ params }: { params: { id: string; invoiceId: string } }) {
  const router = useRouter();
  const query = useSearchParams();

  const [inv, setInv] = useState<Invoice | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [items, setItems] = useState<Item[]>([{ ...LINHA_VAZIA }]);
  const [erro, setErro] = useState<string | null>(null);
  const [problemas, setProblemas] = useState<{ campo: string; mensagem: string }[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [linkPublico, setLinkPublico] = useState<string | null>(null);
  const [emailPara, setEmailPara] = useState("");
  const [enviado, setEnviado] = useState<string | null>(null);
  const [totalDesejado, setTotalDesejado] = useState("");

  const carregar = useCallback(async () => {
    const [ri, rc] = await Promise.all([
      fetch(`/api/clients/${params.id}/invoices/${params.invoiceId}`),
      fetch(`/api/clients/${params.id}/customers`),
    ]);
    const ji = await ri.json();
    const jc = await rc.json();
    setClientes(jc.clientes ?? []);
    if (ji.invoice) {
      setInv(ji.invoice);
      setItems(ji.invoice.items.length
        ? ji.invoice.items.map((i: any) => ({
            description: i.description, detail: i.detail ?? "",
            quantity: i.quantity, unitPrice: i.unitPrice, vatRate: i.vatRate,
          }))
        : [{ ...LINHA_VAZIA }]);
      setEmailPara(ji.invoice.customerEmail || "");
    }
  }, [params.id, params.invoiceId]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Chegar aqui a partir de "emitir fatura" na lista de clientes já traz o
  // cliente escolhido — poupa o passo que se ia fazer a seguir de qualquer forma.
  useEffect(() => {
    const pre = query.get("customer");
    if (pre && inv && !inv.customerId && clientes.length) {
      const c = clientes.find((x) => x.id === pre);
      if (c) escolherCliente(c);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientes, inv]);

  const totais = useMemo(() => calcularInvoice(
    items.filter((i) => i.description.trim()).map((i) => ({
      description: i.description, detail: i.detail,
      quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0,
      vatRate: Number(i.vatRate) || 0,
    }))
  ), [items]);

  const editavel = inv?.status === "draft";

  function escolherCliente(c: Cliente) {
    setInv((v) => v && ({
      ...v, customerId: c.id, customerName: c.name, customerVat: c.vatNumber,
      customerAddr: c.address, customerShip: c.shipAddress, customerEmail: c.email,
    }));
    setEmailPara(c.email || "");
  }

  async function gravar(): Promise<boolean> {
    if (!inv) return false;
    setOcupado("gravar"); setErro(null);
    try {
      const r = await fetch(`/api/clients/${params.id}/invoices/${params.invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...inv, items }),
      });
      if (!r.ok) { setErro((await r.json()).error || "Não gravou."); return false; }
      return true;
    } finally { setOcupado(null); }
  }

  async function emitir() {
    if (!inv) return;
    if (!confirm(
      "Emitir esta fatura?\n\n"
      + "Ganha número definitivo, vira uma venda (entra no VAT e abre título a receber) "
      + "e deixa de poder ser editada. Para corrigir depois, só anulando e emitindo outra."
    )) return;

    // Grava ANTES de emitir: o que está no ecrã tem de ser o que é emitido.
    if (!(await gravar())) return;

    setOcupado("emitir"); setErro(null); setProblemas([]);
    try {
      const r = await fetch(`/api/clients/${params.id}/invoices/${params.invoiceId}/emitir`, { method: "POST" });
      const j = await r.json();
      // 422 traz a lista de impedimentos com o campo de cada um — mostra-se a
      // lista, e não um parágrafo, para se ver de uma vez tudo o que falta.
      if (r.status === 422) { setProblemas(j.problemas ?? []); setErro(j.error); return; }
      if (!r.ok) { setErro(j.error || "Não emitiu."); return; }
      // A fatura foi emitida; se a integraçao tropeçou, isso e um AVISO e nao
      // um erro — mostrar a vermelho faria parecer que a emissao falhou, e
      // alguem emitiria a mesma fatura outra vez.
      if (j.aviso) setEnviado(`Fatura emitida. Atenção na integração: ${j.aviso}`);
      await carregar();
    } finally { setOcupado(null); }
  }

  async function gerarLink(): Promise<string | null> {
    const r = await fetch(`/api/clients/${params.id}/invoices/${params.invoiceId}/link`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error || "Não deu para criar o link."); return null; }
    const url = `${location.origin}/api/invoice-share/${j.token}`;
    setLinkPublico(url);
    return url;
  }

  async function enviarEmail() {
    if (!emailPara.trim()) { setErro("Escreva o endereço de e-mail."); return; }
    setOcupado("email"); setErro(null); setEnviado(null);
    try {
      const r = await fetch(`/api/clients/${params.id}/invoices/${params.invoiceId}/enviar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ para: emailPara.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Não enviou."); return; }
      setEnviado(`Enviada para ${j.para}.`);
      await carregar();
    } finally { setOcupado(null); }
  }

  async function abrirWhatsapp() {
    const url = linkPublico ?? await gerarLink();
    if (!url || !inv) return;
    const cliente = clientes.find((c) => c.id === inv.customerId);
    const msg = `Olá ${inv.customerName}, segue a fatura ${inv.number}`
      + `${inv.dueDate ? `, com vencimento a ${inv.dueDate}` : ""}: ${url}`;
    window.open(linkDeWhatsapp(cliente?.phone ?? null, msg), "_blank", "noopener");
  }

  if (!inv) return <p className="text-sm text-muted">A carregar…</p>;

  const pdfUrl = `/api/clients/${params.id}/invoices/${params.invoiceId}/pdf`;

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {inv.status === "draft" ? "Nova fatura" : inv.number}
          </h1>
          <p className="mt-1 text-muted">
            {inv.status === "draft"
              ? "Rascunho — ainda não consome número nem entra na contabilidade."
              : inv.status === "cancelled"
                ? "Anulada. O número fica na sequência, para não abrir buraco."
                : `Emitida. ${inv.sentTo ? `Enviada para ${inv.sentTo}.` : "Ainda não enviada."}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn-ghost inline-flex h-9 items-center px-3 text-sm" href={`/clients/${params.id}/invoices`}>
            Voltar
          </Link>
          <a className="btn-ghost inline-flex h-9 items-center px-3 text-sm" href={pdfUrl} target="_blank" rel="noreferrer">
            Ver PDF
          </a>
          {editavel ? (
            <>
              <button className="btn-ghost h-9 px-3 text-sm" disabled={!!ocupado} onClick={gravar}>
                {ocupado === "gravar" ? "A gravar…" : "Gravar"}
              </button>
              <button className="btn-primary h-9 px-4 text-sm" disabled={!!ocupado} onClick={emitir}>
                {ocupado === "emitir" ? "A emitir…" : "Emitir"}
              </button>
            </>
          ) : inv.status !== "cancelled" && (
            <a className="btn-ghost inline-flex h-9 items-center px-3 text-sm" href={`${pdfUrl}?download=1`}>
              Baixar PDF
            </a>
          )}
        </div>
      </div>

      {erro && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {problemas.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          {problemas.map((p, i) => <li key={i}>• {p.mensagem}</li>)}
        </ul>
      )}
      {enviado && <p className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm">{enviado}</p>}

      {/* ------------------------------------------------------ o destinatário */}
      <section className="card p-5">
        <h2 className="font-display text-sm font-semibold">Para quem</h2>
        {editavel ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <F label="Cliente">
              <select className="input" value={inv.customerId ?? ""}
                onChange={(e) => {
                  const c = clientes.find((x) => x.id === e.target.value);
                  if (c) escolherCliente(c);
                }}>
                <option value="">— escolha —</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </F>
            <F label="Referência do comprador">
              <input className="input" placeholder="o PO dele, se pediu"
                value={inv.customerRef ?? ""}
                onChange={(e) => setInv({ ...inv, customerRef: e.target.value })} />
            </F>
            <F label="E-mail">
              <input className="input" value={inv.customerEmail ?? ""}
                onChange={(e) => setInv({ ...inv, customerEmail: e.target.value })} />
            </F>
            <F label="Morada de faturação" largo>
              <textarea className="input min-h-[70px] py-2" rows={3}
                value={inv.customerAddr ?? ""}
                onChange={(e) => setInv({ ...inv, customerAddr: e.target.value })} />
            </F>
            <F label="Morada de entrega (vazio = não sai na fatura)" largo>
              <textarea className="input min-h-[70px] py-2" rows={3}
                value={inv.customerShip ?? ""}
                onChange={(e) => setInv({ ...inv, customerShip: e.target.value })} />
            </F>
          </div>
        ) : (
          <div className="mt-2 text-sm">
            <p className="font-medium">{inv.customerName}</p>
            {inv.customerVat && <p className="text-muted">VAT {inv.customerVat}</p>}
            <p className="whitespace-pre-line text-muted">{inv.customerAddr}</p>
          </div>
        )}
        {clientes.length === 0 && editavel && (
          <p className="mt-3 text-xs text-muted">
            Ainda não há clientes cadastrados.{" "}
            <Link className="underline" href={`/clients/${params.id}/customers`}>Criar o primeiro</Link>.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------- as datas */}
      <section className="card p-5">
        <h2 className="font-display text-sm font-semibold">Datas e condições</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <F label="Data de emissão">
            <input type="date" className="input" disabled={!editavel} value={inv.issueDate}
              onChange={(e) => {
                const d = e.target.value;
                // O vencimento acompanha a emissão enquanto ninguém lhe mexeu à
                // mão: mudar a data e ficar com o vencimento antigo é o erro
                // que passa despercebido.
                setInv({ ...inv, issueDate: d, dueDate: vencimentoDosTermos(d, inv.paymentTerms) ?? inv.dueDate });
              }} />
          </F>
          <F label="Condições de pagamento">
            <input className="input" disabled={!editavel} placeholder="30 dias"
              value={inv.paymentTerms ?? ""}
              onChange={(e) => {
                const t = e.target.value;
                setInv({ ...inv, paymentTerms: t, dueDate: vencimentoDosTermos(inv.issueDate, t) ?? inv.dueDate });
              }} />
          </F>
          <F label="Vencimento">
            <input type="date" className="input" disabled={!editavel} value={inv.dueDate ?? ""}
              onChange={(e) => setInv({ ...inv, dueDate: e.target.value || null })} />
          </F>
        </div>
      </section>

      {/* --------------------------------------------------------- as linhas */}
      <section className="card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-sm font-semibold">Linhas</h2>
          {editavel && (
            <button className="btn-ghost h-8 px-3 text-xs"
              onClick={() => setItems([...items, { ...LINHA_VAZIA }])}>
              + linha
            </button>
          )}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                <th className="py-1 text-left font-medium">Descrição</th>
                <th className="w-20 py-1 text-right font-medium">Qtd</th>
                <th className="w-28 py-1 text-right font-medium">Preço unit.</th>
                <th className="w-24 py-1 text-right font-medium">VAT %</th>
                <th className="w-28 py-1 text-right font-medium">IVA</th>
                {/* Líquido, sem IVA: a coluna tem de fechar com o subtotal. */}
                <th className="w-28 py-1 text-right font-medium">Valor s/ IVA</th>
                {editavel && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const c = totais.linhas.find((_, k) =>
                  items.filter((x) => x.description.trim()).indexOf(it) === k);
                return (
                  <tr key={i} className="border-b border-line/40 align-top">
                    <td className="py-1.5 pr-2">
                      <input className="input h-8 w-full" placeholder="Consulting services"
                        disabled={!editavel} value={it.description}
                        onChange={(e) => troca(i, { description: e.target.value })} />
                      <input className="input mt-1 h-7 w-full text-[11.5px]" placeholder="detalhe (opcional)"
                        disabled={!editavel} value={it.detail}
                        onChange={(e) => troca(i, { detail: e.target.value })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input type="number" step="0.01" className="input h-8 w-full text-right"
                        disabled={!editavel} value={it.quantity}
                        onChange={(e) => troca(i, { quantity: Number(e.target.value) })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input type="number" step="0.01" className="input h-8 w-full text-right"
                        disabled={!editavel} value={it.unitPrice}
                        onChange={(e) => troca(i, { unitPrice: Number(e.target.value) })} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <select className="input h-8 w-full text-right" disabled={!editavel} value={it.vatRate}
                        onChange={(e) => troca(i, { vatRate: Number(e.target.value) })}>
                        {TAXAS.map((t) => <option key={t} value={t}>{t}%</option>)}
                      </select>
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums text-muted">{c ? eur(c.vat) : "—"}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums font-semibold">
                      {c ? eur(c.net) : "—"}
                    </td>
                    {editavel && (
                      <td className="py-2.5 text-right">
                        <button className="btn-ghost h-7 px-1.5 text-[11px] text-danger"
                          onClick={() => setItems(items.length > 1 ? items.filter((_, k) => k !== i) : [{ ...LINHA_VAZIA }])}>
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Os totais, com o IVA aberto por alíquota — é o que a fatura tem de
            mostrar, e o que o comprador confere. */}
        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-xs space-y-1.5 text-[13px]">
            <Total rotulo="Subtotal" valor={eur(totais.net)} />
            {totais.porTaxa.filter((g) => g.vat > 0).map((g) => (
              <Total key={g.rate} rotulo={`VAT ${g.rate}%`} valor={eur(g.vat)} />
            ))}
            <div className="mt-2 flex items-center justify-between rounded-lg bg-brand/10 px-3 py-2">
              <span className="font-semibold">Total</span>
              <span className="font-mono text-lg font-semibold tabular-nums text-brand">{eur(totais.gross)}</span>
            </div>
          </div>
        </div>

        {/*
          * CÁLCULO POR DENTRO — vive ao lado dos totais, que é o número que ele
          * muda. Posto no topo da tela, obrigaria a olhar para dois sítios ao
          * mesmo tempo para perceber o que aconteceu.
          */}
        {editavel && (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-muted">
                O cliente vai pagar (com IVA)
              </span>
              <input
                className="input h-9 w-40 text-right"
                inputMode="decimal"
                placeholder="2800,00"
                value={totalDesejado}
                onChange={(e) => setTotalDesejado(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); calcularPorDentro(); } }}
              />
            </label>
            <button className="btn-ghost h-9 px-4 text-sm" onClick={calcularPorDentro}>
              Calcular por dentro
            </button>
            <span className="max-w-md text-xs text-muted">
              Ajusta os preços unitários para o total fechar nesse valor, repartindo pela proporção
              que as linhas já têm. As quantidades não mudam.
            </span>
          </div>
        )}

        <label className="mt-4 flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">Nota na fatura</span>
          <input className="input" disabled={!editavel} value={inv.notes ?? ""}
            onChange={(e) => setInv({ ...inv, notes: e.target.value })} />
        </label>
      </section>

      {/* ---------------------------------------------------------- o envio */}
      {(inv.status === "issued" || inv.status === "sent") && (
        <section className="card p-5">
          <h2 className="font-display text-sm font-semibold">Enviar</h2>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-muted">E-mail do cliente</span>
              <input className="input h-9 w-72" value={emailPara}
                onChange={(e) => setEmailPara(e.target.value)} />
            </label>
            <button className="btn-primary h-9 px-4 text-sm" disabled={!!ocupado} onClick={enviarEmail}>
              {ocupado === "email" ? "A enviar…" : "Enviar por e-mail"}
            </button>
            <span className="text-xs text-muted">Vai com o PDF anexado.</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button className="btn-ghost h-9 px-4 text-sm" onClick={abrirWhatsapp}>
              Abrir no WhatsApp
            </button>
            {/*
              * Diz-se o que ACONTECE, e não "enviar por WhatsApp".
              *
              * O WhatsApp não aceita anexo por link — sem a API de negócio da
              * Meta o que dá é abrir a conversa com o texto pronto. Chamar-lhe
              * "enviar" faria alguém fechar a janela a pensar que já foi.
              */}
            <span className="text-xs text-muted">
              Abre a conversa com a mensagem e um link para o PDF — falta carregar em enviar lá.
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button className="btn-ghost h-9 px-4 text-sm" onClick={gerarLink}>
              {linkPublico ? "Link criado" : "Criar link para partilhar"}
            </button>
            {linkPublico && (
              <>
                <input className="input h-9 flex-1 min-w-[280px] font-mono text-[11px]" readOnly value={linkPublico}
                  onFocus={(e) => e.currentTarget.select()} />
                <button className="btn-ghost h-9 px-3 text-xs"
                  onClick={() => navigator.clipboard?.writeText(linkPublico)}>
                  copiar
                </button>
              </>
            )}
            <span className="text-xs text-muted">
              Quem tiver o endereço vê esta fatura, sem entrar no sistema. Anular a fatura fecha o link.
            </span>
          </div>
        </section>
      )}

      {inv.status !== "cancelled" && (
        <div className="flex justify-end">
          <button
            className="btn-ghost h-8 px-3 text-xs text-danger"
            onClick={async () => {
              const rascunho = inv.status === "draft";
              if (!confirm(rascunho
                ? "Apagar este rascunho?"
                : "Anular esta fatura?\n\nO número fica na sequência (para não abrir buraco) e a venda é desfeita. "
                  + "Só funciona se a venda ainda não tiver sido contabilizada nem baixada no banco."
              )) return;
              const r = await fetch(`/api/clients/${params.id}/invoices/${params.invoiceId}`, { method: "DELETE" });
              const j = await r.json().catch(() => ({}));
              if (!r.ok) { setErro(j.error || "Não deu."); return; }
              if (rascunho) router.push(`/clients/${params.id}/invoices`);
              else await carregar();
            }}
          >
            {inv.status === "draft" ? "Apagar rascunho" : "Anular fatura"}
          </button>
        </div>
      )}
    </div>
  );

  /**
   * "O cliente paga 2.800" — e o sistema acha o líquido.
   *
   * Reescreve os preços unitários para o TOTAL bater no que foi combinado. Ver
   * `porDentro` em lib/invoicing/calculo.ts, onde está por que a conta não é
   * tirar 23% do bruto.
   */
  function calcularPorDentro() {
    setErro(null);
    const alvo = Number(String(totalDesejado).replace(",", "."));
    const r = porDentro(
      items.filter((i) => i.description.trim()).map((i) => ({
        description: i.description, detail: i.detail,
        quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0,
        vatRate: Number(i.vatRate) || 0,
      })),
      alvo
    );
    // Um alvo inalcançável AINDA aplica o resultado mais próximo, e avisa: é
    // melhor ficar a um cêntimo com aviso do que não fazer nada e deixar a
    // pessoa a carregar no botão sem perceber porquê.
    if (r.erro) setErro(r.erro);

    /*
     * As linhas SEM descrição ficam onde estão.
     *
     * `porDentro` só recebe as preenchidas — devolver a lista dela por cima da
     * do ecrã apagaria as linhas em branco que a pessoa acabou de abrir para
     * escrever.
     */
    let k = 0;
    setItems(items.map((it) =>
      it.description.trim() ? { ...it, unitPrice: r.linhas[k++]?.unitPrice ?? it.unitPrice } : it));
  }

  function troca(i: number, patch: Partial<Item>) {
    setItems(items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  }
}

function F({ label, children, largo }: { label: string; children: React.ReactNode; largo?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${largo ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  );
}

function Total({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{rotulo}</span>
      <span className="font-mono tabular-nums">{valor}</span>
    </div>
  );
}
