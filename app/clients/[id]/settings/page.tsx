"use client";

/**
 * Cadastro do cliente — tudo o que se configura uma vez, num lugar só.
 *
 * Junta o que estava espalhado em três lugares: os dados da empresa (que só
 * dava para editar voltando para a lista de clientes), as filiais e a entrada
 * por e-mail. As três são configuração, não trabalho do dia — e enquanto
 * ocupavam a mesma fila de abas das telas de uso diário, empurravam as de
 * trabalho para fora do campo de visão.
 */

import { useCallback, useEffect, useState } from "react";
import ClientBranches from "@/components/ClientBranches";
import ClientIntegrations from "@/components/ClientIntegrations";
import ClientVault from "@/components/ClientVault";
import ClientInvoiceBranding from "@/components/ClientInvoiceBranding";
import ClientMailSetup from "@/components/ClientMailSetup";
import ClientPhoneLinks from "@/components/ClientPhoneLinks";
import { invalidateClient } from "@/lib/clientCache";
import type { Client } from "@/lib/types";
import { FORMAS } from "@/lib/fiscal/formaJuridica";

const ACTIVITIES = [
  { code: "GENERIC", label: "Generic business" },
  { code: "RESTAURANT", label: "Restaurant / catering" },
  { code: "RETAIL", label: "Retail / shop" },
  { code: "CONSTRUCTION", label: "Construction" },
  { code: "TRANSPORT", label: "Transport / haulage" },
  { code: "PROFESSIONAL", label: "Professional services" },
  { code: "BEAUTY", label: "Beauty / hairdressing" },
  { code: "FARM", label: "Farming / agriculture" },
];

export default function ClientSettings({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [categories, setCategories] = useState<{ code: string | null; description: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const d = await (await fetch(`/api/clients/${params.id}`, { cache: "no-store" })).json();
    setClient(d.client || null);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/base").then((r) => r.json()).then((d) => setCategories(d.categories || []));
  }, []);

  function set<K extends keyof Client>(k: K, v: Client[K]) {
    setClient((prev) => (prev ? { ...prev, [k]: v } : prev));
    setDirty(true);
    setMsg(null);
  }

  function toggleCategory(code: string) {
    if (!client) return;
    const list = client.related_categories || [];
    set("related_categories", list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);
  }

  async function save() {
    if (!client) return;
    if (!client.name.trim()) { setMsg({ text: "A razão social é obrigatória.", error: true }); return; }
    setSaving(true);
    try {
      const activity = ACTIVITIES.find((a) => a.code === client.activity_code);
      const res = await fetch(`/api/clients/${params.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: client.name, activity_code: client.activity_code,
          activity_label: activity?.label || client.activity_label,
          trading_name: client.trading_name, legal_form: client.legal_form || null,
          director: client.director, cro: client.cro,
          vat_number: client.vat_number, tax_reg_no: client.tax_reg_no,
          email: client.email, phone: client.phone, address: client.address, notes: client.notes,
          related_categories: client.related_categories,
          default_credit_unmatched: client.default_credit_unmatched,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ text: d.error || "Erro ao salvar.", error: true }); return; }
      // O cabeçalho e o menu leem o cadastro de um cache curto; sem isto,
      // trocar a razão social continuaria a mostrar o nome antigo no topo.
      invalidateClient(params.id);
      setDirty(false);
      setMsg({ text: "Cadastro salvo." });
      await load();
    } finally { setSaving(false); }
  }

  if (!client) return <p className="text-muted">Carregando…</p>;

  return (
    <div className="space-y-6">
      <section className="card rise p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Dados da empresa</h2>
            <p className="mt-0.5 text-sm text-muted">
              O código do cliente não muda depois de criado: ele viaja nos lançamentos e nos arquivos
              exportados.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {msg && (
              <span className={`text-sm ${msg.error ? "text-danger" : "text-brand-700"}`}>{msg.text}</span>
            )}
            <button className="btn-primary h-9 px-4 text-sm" onClick={save} disabled={saving || !dirty}>
              {saving ? "Salvando…" : "Salvar cadastro"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Razão social *">
            <input className="input" value={client.name} onChange={(e) => set("name", e.target.value)} />
          </F>
          <F label="Código do cliente">
            <input className="input font-mono" value={client.client_code} disabled />
          </F>
          <F label="Tipo de negócio">
            <select className="input" value={client.activity_code}
              onChange={(e) => set("activity_code", e.target.value)}>
              {ACTIVITIES.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </F>
          {/*
            * A FORMA JURÍDICA é o campo que decide o resto.
            *
            * Sole trader entrega Form 11; sociedade entrega CT1 e as contas no
            * CRO. Sem ele, um calendário de obrigações mostraria a declaração
            * errada — e um alerta que não se aplica ensina a fechar o aviso sem
            * ler. Ver lib/fiscal/formaJuridica.ts.
            *
            * "por classificar" é uma opção de verdade e não um placeholder: é
            * o estado de todos os clientes que já existiam, e adivinhar um
            * valor faria o sistema deixar de cobrar as contas anuais de uma
            * sociedade, em silêncio.
            */}
          <F label="Forma jurídica">
            <select className="input" value={client.legal_form ?? ""}
              onChange={(e) => {
                // O `value` de um <select> é string; o campo só aceita as duas
                // formas ou nulo, e é aqui que se estreita.
                const v = e.target.value;
                set("legal_form", v === "sole_trader" || v === "limited_company" ? v : null);
              }}>
              <option value="">por classificar</option>
              {FORMAS.map((f) => (
                <option key={f.valor} value={f.valor}>{f.rotulo} ({f.curto})</option>
              ))}
            </select>
          </F>
          <F label="Nome comercial">
            <input className="input" placeholder="se for diferente da razão social"
              value={client.trading_name ?? ""} onChange={(e) => set("trading_name", e.target.value)} />
          </F>
          <F label={client.legal_form === "sole_trader" ? "Titular" : "Diretor"}>
            <input className="input" value={client.director ?? ""}
              onChange={(e) => set("director", e.target.value)} />
          </F>
          <F label="Número do CRO">
            <input className="input font-mono" placeholder="só sociedades"
              value={client.cro ?? ""} onChange={(e) => set("cro", e.target.value)} />
          </F>
          <F label="Número de VAT">
            <input className="input font-mono" placeholder="IE1234567X"
              value={client.vat_number ?? ""} onChange={(e) => set("vat_number", e.target.value)} />
          </F>
          <F label="Nº de registro fiscal (Revenue)">
            <input className="input" value={client.tax_reg_no ?? ""} onChange={(e) => set("tax_reg_no", e.target.value)} />
          </F>
          <F label="E-mail de contato">
            <input className="input" value={client.email ?? ""} onChange={(e) => set("email", e.target.value)} />
          </F>
          <F label="Telefone">
            <input className="input" value={client.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
          </F>
          <F label="Endereço">
            <input className="input" value={client.address ?? ""} onChange={(e) => set("address", e.target.value)} />
          </F>
          <F label="Observações">
            <input className="input" value={client.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </F>
        </div>

        <div className="mt-4 rounded-xl2 border border-line bg-surface-2 p-3">
          <div className="text-sm font-medium">Categorias que este cliente vende / usa</div>
          <p className="mt-0.5 text-xs text-muted">
            Opcional. Depois de marcar ao menos uma, um item de compra cuja categoria não está nesta
            lista vem marcado como &quot;verificar&quot;. Deixar vazio mantém a conferência desligada.
          </p>
          <div className="mt-2 flex max-h-40 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto">
            {categories.filter((c) => c.code).map((c) => (
              <label key={c.code} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
                  checked={(client.related_categories || []).includes(c.code!)}
                  onChange={() => toggleCategory(c.code!)} />
                {c.description}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-line bg-surface-2 p-3">
          <button type="button" role="switch" aria-checked={client.default_credit_unmatched}
            onClick={() => set("default_credit_unmatched", !client.default_credit_unmatched)}
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${client.default_credit_unmatched ? "bg-brand" : "bg-line"}`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${client.default_credit_unmatched ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
          <div>
            <div className="text-sm font-medium">Tomar crédito automaticamente em itens sem regra</div>
            <p className="text-xs text-muted">
              Desligado (recomendado): itens sem regra específica começam desmarcados e você revisa um a
              um. Os bloqueios conhecidos (entretenimento, gasolina de carro de passeio, hospedagem)
              continuam valendo nos dois casos.
            </p>
          </div>
        </div>
      </section>

      {/*
        * O cofre fica LOGO A SEGUIR aos dados da empresa, e antes das
        * integrações: identidade, morada e pacto social são a mesma pergunta
        * que os campos acima — quem é este cliente — só que em papel.
        */}
      {/* O que sai impresso nas faturas deste cliente. */}
      <ClientInvoiceBranding clientId={params.id} />

      <ClientVault clientId={params.id} />

      {/* O que este cliente alimenta automaticamente — ver lib/integrations.ts. */}
      <ClientIntegrations clientId={params.id} />

      <section className="card rise p-5">
        <ClientBranches clientId={params.id} />
      </section>

      <section className="card rise p-5">
        <ClientMailSetup clientId={params.id} />
      </section>

      <section className="card rise p-5">
        <ClientPhoneLinks clientId={params.id} />
      </section>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
