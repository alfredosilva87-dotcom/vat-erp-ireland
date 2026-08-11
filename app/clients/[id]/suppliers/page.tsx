"use client";

/**
 * Regras de fornecedor (camada B1).
 *
 * O que esta tela existe para tornar visível é a PRECEDÊNCIA. O sistema já
 * decidia conta e categoria em dois lugares — a escolha do contador na nota e o
 * que ele fez em notas anteriores — e nenhum dos dois estava escrito em lugar
 * nenhum. Uma regra que "não funciona" quase sempre é uma regra que funciona e
 * está sendo sobreposta, ou que está sobrepondo. Por isso a ordem aparece no
 * topo, numerada, antes de qualquer campo.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SupplierRuleCard from "@/components/SupplierRuleCard";
import type { SupplierRule } from "@/lib/supplierRules";
import type { ChartAccount, VatCategory } from "@/lib/types";

export default function SupplierRules({ params }: { params: { id: string } }) {
  const [rules, setRules] = useState<SupplierRule[]>([]);
  const [accounts, setAccounts] = useState<{ code: string; description: string }[]>([]);
  const [categories, setCategories] = useState<{ code: string; description: string; vat_rate: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [vat, setVat] = useState("");
  const [nameMatch, setNameMatch] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const [r, a, b] = await Promise.all([
      fetch(`/api/clients/${params.id}/supplier-rules`, { cache: "no-store" }),
      fetch(`/api/clients/${params.id}/accounts`, { cache: "no-store" }),
      fetch("/api/base", { cache: "no-store" }),
    ]);
    setRules((await r.json()).rules || []);
    setAccounts(((await a.json()).accounts || []).map((x: ChartAccount) => ({ code: x.code, description: x.description })));
    setCategories(
      ((await b.json()).categories || [])
        .filter((c: VatCategory) => c.active && c.code)
        .map((c: VatCategory) => ({ code: c.code as string, description: c.description, vat_rate: c.vat_rate }))
    );
    setLoading(false);
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!label.trim()) { setMsg({ text: "Dê um nome à regra.", error: true }); return; }
    if (!vat.trim() && !nameMatch.trim()) {
      setMsg({ text: "Diga como reconhecer o fornecedor: o número de VAT, um pedaço do nome, ou os dois.", error: true });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${params.id}/supplier-rules`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, supplier_vat: vat, name_match: nameMatch }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ text: d.error || "Erro.", error: true }); return; }
      setLabel(""); setVat(""); setNameMatch("");
      setMsg({ text: "Regra criada. Abra em Editar para dizer o que ela decide." });
      await load();
    } finally { setBusy(false); }
  }

  async function save(id: string, patch: Partial<SupplierRule>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${params.id}/supplier-rules/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      setMsg(res.ok ? { text: "Salva." } : { text: d.error || "Erro ao salvar.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Apagar esta regra? As notas que ela já preencheu continuam como estão.")) return;
    setBusy(true);
    try {
      await fetch(`/api/clients/${params.id}/supplier-rules/${id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-xl font-semibold tracking-tight">Regras de fornecedor</h1>
        <p className="mt-1 text-muted">
          Decidem conta contábil, categoria de VAT e se vale a pena detalhar as linhas — por fornecedor, uma
          vez, e valem para toda nota daquele fornecedor que entrar depois.
        </p>
      </div>

      <div className="card rise p-5">
        <p className="label mb-2">Quem decide o quê, nesta ordem</p>
        <ol className="space-y-2 text-sm">
          <li className="flex gap-3">
            <span className="chip bg-ink text-paper shrink-0">1</span>
            <span>
              <strong>O que você escolhe na nota.</strong> Manda sempre. Corrigir uma nota não muda a regra —
              se a correção vale para o fornecedor inteiro, mude a regra aqui.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="chip bg-brand text-white shrink-0">2</span>
            <span>
              <strong>Regra de fornecedor.</strong> Esta tela. Sobrepõe o que o sistema aprendeu, porque é
              decisão escrita de propósito e não estatística sobre o passado.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="chip bg-surface-2 border border-line text-muted shrink-0">3</span>
            <span>
              <strong>O que o sistema aprendeu</strong> — a memória de item→conta e a categorização por
              palavra ou por IA. É o que preenche o que ninguém decidiu.
            </span>
          </li>
        </ol>
      </div>

      <div className="card rise p-4">
        <p className="label mb-2">Nova regra</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px_auto]">
          <input className="input" placeholder="Nome (ex.: Vodafone — telecom)"
            value={label} onChange={(e) => setLabel(e.target.value)} />
          <input className="input font-mono" placeholder="Número de VAT"
            value={vat} onChange={(e) => setVat(e.target.value)} />
          <input className="input" placeholder="ou pedaço do nome"
            value={nameMatch} onChange={(e) => setNameMatch(e.target.value)} />
          <button className="btn-primary" onClick={create} disabled={busy}>Criar</button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Preencha o número de VAT quando a nota traz — é o reconhecimento que não depende de como o nome foi
          impresso. O pedaço do nome é a alternativa para recibo que não traz VAT.
        </p>
        {msg && (
          <p className={`mt-2 text-sm ${msg.error ? "text-danger" : "text-brand-700"}`}>{msg.text}</p>
        )}
      </div>

      {loading ? (
        <p className="card p-6 text-muted">Carregando…</p>
      ) : !rules.length ? (
        <p className="card p-6 text-muted">
          Nenhuma regra ainda. As que costumam pagar sozinhas são as do fornecedor recorrente cujo detalhe
          ninguém confere: a fatura da luz, o telefone, o aluguel.
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <SupplierRuleCard key={r.id} rule={r} accounts={accounts} categories={categories}
              busy={busy} onSave={save} onDelete={remove} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted">
        Duas regras não podem repetir o mesmo número de VAT nem o mesmo pedaço de nome — o sistema recusa na
        hora de salvar. Quando duas regras <em>diferentes</em> reconhecem a mesma nota e discordam (“ireland” e
        “limited” contra “Vodafone Ireland Limited”), nenhuma das duas é aplicada e a nota chega marcada para
        revisão dizendo quais foram: escolher uma no par ou ímpar seria decidir a conta contábil por sorteio.
      </p>

      {!accounts.length && !loading && (
        <p className="text-xs text-muted">
          Este cliente ainda não tem <Link href={`/clients/${params.id}/accounts`} className="text-brand-700">plano de contas</Link>,
          então não há conta para a regra escolher.
        </p>
      )}
    </div>
  );
}
