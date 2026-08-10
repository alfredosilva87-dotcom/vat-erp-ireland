"use client";

/**
 * Regras de banco (camada A3).
 *
 * A lista está na ordem em que as regras são avaliadas, de cima para baixo, e
 * **para na primeira que casa**. Por isso a ordem aparece numerada, com setas,
 * e por isso a tela avisa quando uma regra de cima engole outra de baixo — esse
 * é o erro que mais custa tempo, porque a regra engolida parece certa.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BankRuleCard from "@/components/BankRuleCard";
import type { BankRule } from "@/lib/bankRules";
import type { BankAccount, ChartAccount } from "@/lib/types";

export default function BankRules({ params }: { params: { id: string } }) {
  const [rules, setRules] = useState<BankRule[]>([]);
  const [shadowed, setShadowed] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<{ code: string; description: string }[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const [r, a, b] = await Promise.all([
      fetch(`/api/clients/${params.id}/bank-rules`, { cache: "no-store" }),
      fetch(`/api/clients/${params.id}/accounts`, { cache: "no-store" }),
      fetch(`/api/clients/${params.id}/bank-accounts`, { cache: "no-store" }),
    ]);
    const rd = await r.json();
    setRules(rd.rules || []);
    setShadowed(Object.fromEntries((rd.shadowed || []).map((s: any) => [s.ruleId, s.shadowedByName])));
    setAccounts(((await a.json()).accounts || []).map((x: ChartAccount) => ({ code: x.code, description: x.description })));
    setBankAccounts((await b.json()).accounts || []);
    setLoading(false);
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim()) { setMsg({ text: "Dê um nome à regra.", error: true }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${params.id}/bank-rules`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ text: d.error || "Erro.", error: true }); return; }
      setName("");
      setMsg({ text: "Regra criada no fim da fila. Abra em Editar para dizer o que ela casa." });
      await load();
    } finally { setBusy(false); }
  }

  async function save(id: string, patch: Partial<BankRule>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${params.id}/bank-rules/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      setMsg(res.ok ? { text: "Salva." } : { text: d.error || "Erro ao salvar.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function move(id: string, dir: "up" | "down") {
    setBusy(true);
    try {
      await fetch(`/api/clients/${params.id}/bank-rules/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ move: dir }),
      });
      await load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Apagar esta regra? Os lançamentos que ela já ajudou a criar continuam.")) return;
    setBusy(true);
    try {
      await fetch(`/api/clients/${params.id}/bank-rules/${id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div className="rise">
        <Link href={`/clients/${params.id}/bank`} className="text-xs font-medium text-brand-700">
          ← Contas bancárias
        </Link>
        <h1 className="mt-0.5 font-display text-xl font-semibold tracking-tight">Regras de banco</h1>
        <p className="mt-1 text-muted">
          Avaliadas de cima para baixo, e <strong>para na primeira que casa</strong> — uma regra ampla no
          topo engole as específicas abaixo. Regra <strong>sugere</strong>: a conciliação chega preenchida e
          continua esperando você confirmar.
        </p>
      </div>

      <div className="card rise p-4">
        <p className="label mb-2">Nova regra</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input className="input" placeholder="Nome (ex.: Tarifa mensal do banco)"
            value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary" onClick={create} disabled={busy}>Criar</button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Nasce no fim da fila de propósito: entrar no topo faria dela a primeira a casar, engolindo em
          silêncio o que já estava funcionando.
        </p>
        {msg && (
          <p className={`mt-2 text-sm ${msg.error ? "text-danger" : "text-brand-700"}`}>{msg.text}</p>
        )}
      </div>

      {loading ? (
        <p className="card p-6 text-muted">Carregando…</p>
      ) : !rules.length ? (
        <p className="card p-6 text-muted">
          Nenhuma regra ainda. A primeira que costuma valer a pena é a da tarifa mensal do banco.
        </p>
      ) : (
        <div className="space-y-3">
          {rules.map((r, i) => (
            <BankRuleCard key={r.id} rule={r} position={i + 1} total={rules.length}
              accounts={accounts} shadowedBy={shadowed[r.id] ?? null} busy={busy}
              onSave={save} onMove={move} onDelete={remove} />
          ))}
        </div>
      )}

      {!!bankAccounts.length && (
        <p className="text-xs text-muted">
          Regras valem para todas as contas do cliente ({bankAccounts.map((b) => b.name).join(", ")}),
          a não ser que a regra diga o contrário.
        </p>
      )}
    </div>
  );
}
