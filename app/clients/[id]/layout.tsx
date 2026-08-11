"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Client } from "@/lib/types";
import { setCurrentClient } from "@/lib/currentClient";
import ExportPanel from "@/components/ExportPanel";
import { useT, type TKey } from "@/lib/i18n";

// Everything you can do with a client lives here, so opening a sub-screen
// never loses the client context the way the old button row did.
//
// Três abas saíram nesta revisão, e cada uma por um motivo de lugar:
//   - "Visão geral" virou parte do Painel. Eram duas telas respondendo à mesma
//     pergunta, e a pessoa tinha de abrir as duas para ter a resposta inteira.
//   - "Filiais" e "E-mail" foram para o Cadastro. As duas são configuração que
//     se faz uma vez, não trabalho do dia; ficavam ocupando a mesma fila das
//     telas de uso diário e empurravam as de trabalho para fora do campo de
//     visão.
const TABS: { seg: string; key: TKey }[] = [
  { seg: "dashboard", key: "client.tabDashboard" },
  { seg: "purchases", key: "client.tabPurchases" },
  { seg: "sales", key: "client.tabSales" },
  { seg: "bank", key: "client.tabBank" },
  { seg: "suppliers", key: "client.tabSuppliers" },
  { seg: "obligations", key: "client.tabObligations" },
  { seg: "vat", key: "client.tabVat" },
  { seg: "accounts", key: "client.tabAccounts" },
  { seg: "settings", key: "client.tabSettings" },
  { seg: "bright", key: "client.tabBright" },
];

export default function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const pathname = usePathname();
  const { t } = useT();
  const [client, setClient] = useState<Client | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    (async () => {
      const c = await (await fetch(`/api/clients/${params.id}`)).json();
      setClient(c.client || null);
    })();
  }, [params.id]);

  const base = `/clients/${params.id}`;
  const currentSeg = pathname === base ? "" : pathname.slice(base.length + 1).split("/")[0];

  function makeActive() {
    if (!client) return;
    setCurrentClient({ id: client.id, name: client.name, activity_code: client.activity_code });
    setActive(true);
  }

  return (
    <div className="space-y-6">
      {/* Client header */}
      <div className="card rise overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 font-display text-lg font-semibold text-white shadow-brand">
              {client ? initials(client.name) : "—"}
            </span>
            <div className="min-w-0">
              <Link href="/clients" className="text-xs font-medium text-brand-700">
                {t("client.allClients")}
              </Link>
              <h1 className="mt-0.5 truncate font-display text-2xl font-semibold tracking-tight">
                {client?.name ?? t("common.loading")}
              </h1>
              {client && (
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span className="font-mono">{client.client_code}</span>
                  <span>{client.activity_label}</span>
                  {client.vat_number && <span className="font-mono">VAT {client.vat_number}</span>}
                  {client.tax_reg_no && <span className="font-mono">TRN {client.tax_reg_no}</span>}
                </div>
              )}
            </div>
          </div>

          {/*
            As ações mais usadas ficam ao lado do nome, em uma linha e sem
            descrição. Eram um cartão inteiro no fim do Painel — o lugar onde
            ninguém procura o que quer fazer AGORA, porque para chegar lá é
            preciso rolar por cima de tudo o que já aconteceu.
          */}
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/analyze" className="btn-primary h-9 px-3 text-sm">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {t("client.newPurchase")}
            </Link>
            <Link href={`${base}/sales`} className="btn-ghost h-9 px-3 text-sm">{t("client.newSale")}</Link>
            <ExportPanel clientId={params.id} />
            <button className="btn-ghost h-9 px-3 text-sm" onClick={makeActive}>
              {active ? t("client.isActive") : t("client.setActive")}
            </button>
          </div>
        </div>

        {/* Sub-panel nav */}
        <div className="flex gap-1 overflow-x-auto border-t border-line bg-surface-2/60 p-2">
          {TABS.map((tab) => {
            const href = tab.seg ? `${base}/${tab.seg}` : base;
            const isActive = currentSeg === tab.seg;
            return (
              <Link
                key={tab.seg || "overview"}
                href={href}
                className={`subnav-item ${isActive ? "subnav-item-active" : ""}`}
              >
                {t(tab.key)}
              </Link>
            );
          })}
        </div>
      </div>

      {children}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}
