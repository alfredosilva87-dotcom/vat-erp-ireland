"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ClientWithStats } from "@/lib/types";
import { setCurrentClient } from "@/lib/currentClient";

const money = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2 });

export default function ClientsOverview() {
  const [clients, setClients] = useState<ClientWithStats[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/clients?stats=1")
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  const totalCredit = clients.reduce((a, c) => a + c.total_credit, 0);

  return (
    <section className="rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Clients</h2>
          <p className="mt-1 text-sm text-muted">Registered companies and their balances.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="chip bg-brand text-white">Total credit € {money(totalCredit)}</span>
          <Link href="/clients" className="btn-ghost h-9 px-3 text-sm">Manage clients</Link>
        </div>
      </div>

      {clients.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <div key={c.id} className="card p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/clients/${c.id}`} className="font-display text-lg font-semibold hover:text-brand">{c.name}</Link>
                  <div className="text-xs text-muted">
                    {c.client_code} · {c.activity_label}
                  </div>
                </div>
                <button
                  className="btn-ghost h-8 px-3 text-xs"
                  onClick={() => setCurrentClient({ id: c.id, name: c.name, activity_code: c.activity_code })}
                >
                  Select
                </button>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Invoices" value={String(c.invoice_count)} />
                <Stat label="Gross €" value={money(c.total_gross)} />
                <Stat label="Credit €" value={money(c.total_credit)} strong />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 card p-6 text-sm text-muted">
          No clients yet.{" "}
          <Link href="/clients" className="text-brand font-medium">Register your first company →</Link>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-2 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`tnum ${strong ? "font-semibold text-brand-700" : ""}`}>{value}</div>
    </div>
  );
}
