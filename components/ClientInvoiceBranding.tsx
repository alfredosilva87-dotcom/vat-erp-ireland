"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A cara da fatura: logótipo, rodapé legal e conta bancária.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É CADASTRO E NÃO UMA OPÇÃO DENTRO DA FATURA
 *
 * São as três coisas que aparecem em TODAS as faturas do cliente e nunca mudam
 * entre uma e outra. Pedi-las na fatura fá-las-ia ser respondidas de novo a
 * cada emissão — e a terceira ou quarta vez sai diferente da primeira.
 *
 * O rodapé legal não é decoração: uma sociedade irlandesa é obrigada a mostrar o
 * número no CRO e os diretores na papelada que emite.
 * ---------------------------------------------------------------------------
 */

type Conta = { id: string; name: string; bank_name: string | null; account_ref: string | null };

export default function ClientInvoiceBranding({ clientId }: { clientId: string }) {
  const [temLogo, setTemLogo] = useState<boolean | null>(null);
  const [versao, setVersao] = useState(0);
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaId, setContaId] = useState<string>("");
  const [rodape, setRodape] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const [rc, rb, rl] = await Promise.all([
      fetch(`/api/clients/${clientId}`, { cache: "no-store" }),
      fetch(`/api/clients/${clientId}/bank-accounts`, { cache: "no-store" }),
      fetch(`/api/clients/${clientId}/logo`, { cache: "no-store" }),
    ]);
    const jc = await rc.json();
    const jb = await rb.json().catch(() => ({}));
    setContaId(jc.client?.invoice_bank_account_id ?? "");
    setRodape(jc.client?.invoice_footer ?? "");
    setContas(jb.accounts ?? jb.bankAccounts ?? []);
    setTemLogo(rl.ok);
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function gravarCampos(patch: Record<string, unknown>) {
    setErro(null);
    const r = await fetch(`/api/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!r.ok) { setErro("Não gravou."); return; }
    setEstado("Gravado.");
    setTimeout(() => setEstado(null), 2000);
  }

  async function enviarLogo() {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    setErro(null);
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(`/api/clients/${clientId}/logo`, { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) { setErro(j.error || "Não deu para gravar o logótipo."); return; }
    setTemLogo(true);
    // O caminho no armazenamento é fixo, então o navegador serviria a imagem
    // antiga da cache. O contador força o pedido novo.
    setVersao((v) => v + 1);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <section className="rounded-xl2 border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">A cara da fatura</h2>
        <p className="text-xs text-muted">
          O que aparece em todas as faturas emitidas por este cliente.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-start gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted">Logótipo</p>
          <div className="mt-2 flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl2 border border-line bg-surface-2">
            {temLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/clients/${clientId}/logo?v=${versao}`} alt="Logótipo"
                className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="px-2 text-center text-[10px] text-muted">sem logótipo</span>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg"
            className="input mt-2 h-8 w-52 py-1 text-[11px]" onChange={enviarLogo} />
          <p className="mt-1 text-[10.5px] text-muted">
            PNG ou JPEG, até 2 MB. Sem logótipo, a fatura sai com as iniciais.
          </p>
          {temLogo && (
            <button className="btn-ghost mt-1 h-7 px-2 text-[11px] text-danger"
              onClick={async () => {
                if (!confirm("Tirar o logótipo?")) return;
                await fetch(`/api/clients/${clientId}/logo`, { method: "DELETE" });
                setTemLogo(false);
              }}>
              tirar logótipo
            </button>
          )}
        </div>

        <div className="min-w-[280px] flex-1 space-y-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted">
              Conta para onde o dinheiro deve ir
            </span>
            <select className="input" value={contaId}
              onChange={(e) => { setContaId(e.target.value); void gravarCampos({ invoice_bank_account_id: e.target.value || null }); }}>
              <option value="">— não mostrar dados bancários —</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.bank_name, c.name, c.account_ref].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
            {contas.length === 0 && (
              <span className="text-[10.5px] text-muted">
                Este cliente ainda não tem contas bancárias registadas, em Financeiro → Banco.
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted">Rodapé legal</span>
            <input className="input" value={rodape}
              placeholder="deixe vazio para montar sozinho a partir do CRO e do diretor"
              onChange={(e) => setRodape(e.target.value)}
              onBlur={() => void gravarCampos({ invoice_footer: rodape.trim() || null })} />
            <span className="text-[10.5px] text-muted">
              Uma sociedade irlandesa tem de mostrar o número no CRO e os diretores na papelada que
              emite. Vazio, monta-se com o que o cadastro já sabe.
            </span>
          </label>
        </div>
      </div>

      {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}
      {estado && <p className="mt-2 text-xs text-muted">{estado}</p>}
    </section>
  );
}
