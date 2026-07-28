"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Client } from "@/lib/types";

type ApiStatus = { configured: boolean; status: { ok: boolean; reason: string; message: string } };

const currentYear = new Date().getFullYear();

export default function BrightPage({ params }: { params: { id: string } }) {
  const [client, setClient] = useState<Client | null>(null);
  const [year, setYear] = useState<number>(currentYear);
  const [api, setApi] = useState<ApiStatus | null>(null);

  const load = useCallback(async () => {
    const c = await (await fetch(`/api/clients/${params.id}`)).json();
    setClient(c.client || null);
    const s = await (await fetch(`/api/clients/${params.id}/bright/push`)).json();
    setApi(s);
  }, [params.id]);
  useEffect(() => { load(); }, [load]);

  const download = (type: "contacts" | "purchases" | "journal") => {
    window.location.href = `/api/clients/${params.id}/bright/export?type=${type}&year=${year}`;
  };

  const exports: Array<{ type: "contacts" | "purchases" | "journal"; title: string; desc: string }> = [
    { type: "contacts", title: "Contacts (CSV)", desc: "Fornecedores das notas + clientes das vendas. Importa em Data Import → Contacts." },
    { type: "purchases", title: "Supplier Invoices — Detailed (CSV)", desc: "Uma linha por item, com nominal code (plano de contas) e VAT. Importa em Data Import → Supplier Invoices." },
    { type: "journal", title: "Journal (CSV)", desc: "Partidas dobradas por nota (Dr despesa + Dr VAT / Cr Accounts Payable). Importa em Data Import → Journals." },
  ];

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/clients/${params.id}`} className="text-sm text-brand">← {client?.name || "Client"}</Link>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Bright / BrightBooks</h1>
          <p className="mt-1 max-w-2xl text-muted">
            Duas vias de integração com o BrightBooks (Surf Accounts): <strong>exportação por CSV</strong>{" "}
            (funciona hoje, importe dentro do Surf) e <strong>conexão via API</strong> (aguardando acesso de parceiro da Bright).
          </p>
        </div>
        <label className="text-sm text-muted">
          Ano{" "}
          <select className="input h-9 w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Via 1 — CSV */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Via 1 · Exportação por CSV</h2>
          <span className="chip bg-emerald-100 text-emerald-800">Disponível</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Baixe o arquivo e importe no BrightBooks em <em>Data Import</em>. Os cabeçalhos das colunas são provisórios
          e ficam num único ponto do código (<code className="font-mono">lib/brightExport.ts → COLS</code>) — quando você
          baixar o template oficial do Surf, ajustamos 1:1.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {exports.map((x) => (
            <div key={x.type} className="rounded-xl border border-line p-4">
              <h3 className="font-medium">{x.title}</h3>
              <p className="mt-1 text-xs text-muted">{x.desc}</p>
              <button className="btn-primary mt-3 h-9 w-full" onClick={() => download(x.type)}>Baixar CSV</button>
            </div>
          ))}
        </div>
      </div>

      {/* Via 2 — API */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">Via 2 · Conexão via API</h2>
          <span className="chip bg-amber-100 text-amber-800">
            {api?.status?.ok ? "Conectado" : "Indisponível"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {api?.status?.message ||
            "Verificando estado da conexão…"}
        </p>
        <ul className="mt-3 list-disc pl-5 text-xs text-muted">
          <li>A API do Surf/BrightBooks não é pública — o acesso é liberado caso a caso pela Bright (partner-gated).</li>
          <li>A estrutura já está pronta: interface <code className="font-mono">BrightConnector</code>, conector Surf e rotas de push.</li>
          <li>Quando a Bright liberar credenciais, aplicamos <code className="font-mono">db/bright_connections.sql</code> e implementamos os TODOs em <code className="font-mono">lib/brightApi.ts</code>.</li>
        </ul>
        <button className="btn-ghost mt-4 h-9" disabled title="Requer acesso de parceiro da Bright">
          Enviar via API (indisponível)
        </button>
      </div>
    </div>
  );
}
