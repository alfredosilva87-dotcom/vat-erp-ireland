"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Client } from "@/lib/types";
import { setCurrentClient } from "@/lib/currentClient";
import { cachedClient, fetchClient } from "@/lib/clientCache";
import ExportPanel from "@/components/ExportPanel";
import { useT } from "@/lib/i18n";

// Everything you can do with a client lives here, so opening a sub-screen
// never loses the client context the way the old button row did.
//
// A navegação por módulo (Financeiro, Fiscal, Vendas...) mora no menu
// lateral agora — ver components/ModuleSidebar.tsx, ligado em AppFrame.tsx
// sempre que a URL está sob /clients/[id]. Este arquivo cuida só do cabeçalho
// com a identidade do cliente e as ações rápidas; zero navegação aqui.
export default function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const { t } = useT();
  /*
   * Começa do que já está em memória.
   *
   * Ao navegar entre telas do mesmo cliente, o cabeçalho pinta o nome no
   * primeiro quadro em vez de mostrar "—" e depois trocar. O pedido continua
   * a acontecer; o que deixa de acontecer é o ecrã esvaziar-se a cada clique.
   */
  const [client, setClient] = useState<Client | null>(() => cachedClient(params.id) ?? null);

  useEffect(() => {
    let vivo = true;
    fetchClient(params.id).then((c) => { if (vivo) setClient(c); });
    return () => { vivo = false; };
  }, [params.id]);

  const base = `/clients/${params.id}`;

  /*
   * Estar trabalhando num cliente É tê-lo como ativo.
   *
   * Antes isso dependia de lembrar de clicar em "Definir como ativo" — e quem
   * esquecia ia para Analisar notas e encontrava a tela apontando para outra
   * empresa. As telas globais (Analisar, Base de dados) leem daqui.
   */
  useEffect(() => {
    if (!client) return;
    setCurrentClient({ id: client.id, name: client.name, activity_code: client.activity_code });
  }, [client]);

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
            {/*
              Aponta para o `analyze` DESTE cliente, não para o genérico.
              Apontava para `/analyze` e o efeito era mudo: quem estava dentro
              de um cliente saía do contexto dele e tinha de o escolher outra
              vez num selector. O `New sale` ao lado sempre fez o correcto — era
              só um dos dois que perdia o cliente pelo caminho.
            */}
            <Link href={`${base}/analyze`} className="btn-primary h-9 px-3 text-sm">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {t("client.newPurchase")}
            </Link>
            <Link href={`${base}/sales`} className="btn-ghost h-9 px-3 text-sm">{t("client.newSale")}</Link>
            <ExportPanel clientId={params.id} />
          </div>
        </div>
      </div>

      {children}
    </div>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}
