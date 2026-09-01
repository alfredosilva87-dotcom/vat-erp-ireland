"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Client } from "@/lib/types";
import { useT } from "@/lib/i18n";
import { MODULES, moduleForSeg, type ModuleKey } from "@/lib/modules";
import { grantsGroup, grantsSeg } from "@/lib/permissions";
import { usePermissions } from "@/components/PermissionScope";
import { cachedClient, fetchClient } from "@/lib/clientCache";
import RailWave from "@/components/RailWave";
import { MARCA } from "@/lib/marca";
import { useMobileNav } from "@/components/MobileNav";

/**
 * O menu de dentro de um cliente.
 *
 * Troca o menu geral por inteiro enquanto se trabalha numa empresa: o módulo
 * aberto expande as rotinas dele ali mesmo, em vez de empurrar o conteúdo com
 * fileiras horizontais. A empresa ativa fica fixa no topo porque "em qual
 * cliente eu estou" é a pergunta mais cara de errar num escritório
 * multiempresa.
 */
const MODULE_ICONS: Record<ModuleKey, React.ReactNode> = {
  vendas: <><path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" /><path d="M3 8h18l-1.2 10.2a2 2 0 0 1-2 1.8H6.2a2 2 0 0 1-2-1.8L3 8Z" /><path d="M9 12v-2M15 12v-2" /></>,
  compras: <><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
  financeiro: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 6V4h10v2" /></>,
  // Livro aberto: e o razao, e o unico icone que ninguem confunde com o de
  // documento fiscal ao lado.
  contabilidade: <><path d="M12 6.5C10.8 5.2 8.9 4.5 6.5 4.5H3v13h3.5c2.4 0 4.3.7 5.5 2" /><path d="M12 6.5C13.2 5.2 15.1 4.5 17.5 4.5H21v13h-3.5c-2.4 0-4.3.7-5.5 2" /><path d="M12 6.5v13" /></>,
  fiscal: <><path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h6" /></>,
  cadastro: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" /></>,
};

const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const Icon = ({ children }: { children: React.ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">{children}</svg>
);
const Chevron = ({ open }: { open: boolean }) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="ml-auto opacity-55" aria-hidden="true">
    <path d={open ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} {...S} strokeWidth={2} />
  </svg>
);

export default function ModuleSidebar({ clientId }: { clientId: string }) {
  const pathname = usePathname();
  const { t } = useT();
  // Mesmo cliente do cabeçalho, mesmo pedido: ver lib/clientCache.ts. Antes o
  // menu e o cabeçalho pediam o cadastro cada um por si, e os dois mostravam
  // "Loading…" a cada navegação dentro da mesma empresa.
  const [client, setClient] = useState<Client | null>(() => cachedClient(clientId) ?? null);
  const { ready, isMaster, screenAccess } = usePermissions();
  const [pendingInbox, setPendingInbox] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetchClient(clientId).then((c) => { if (vivo) setClient(c); });
    return () => { vivo = false; };
  }, [clientId]);

  /*
   * Contador de trabalho parado no módulo Compras.
   *
   * Existe para o rail dizer ONDE há coisa esperando sem ninguém precisar
   * abrir cada rotina para descobrir. Falha em silêncio de propósito: um
   * número que não carregou não pode impedir o menu de aparecer.
   */
  useEffect(() => {
    fetch(`/api/mail/inbox?client=${clientId}&status=pending,read,duplicate`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setPendingInbox((d.items || []).length))
      .catch(() => {});
  }, [clientId, pathname]);

  const base = `/clients/${clientId}`;
  const currentSeg = pathname === base ? "" : pathname.slice(base.length + 1).split("/")[0];
  const activeModule = moduleForSeg(currentSeg);
  /*
   * O módulo some quando NENHUMA rotina dele sobrou, e dentro do que sobrou o
   * item também some — é a árvore de permissões chegando no menu.
   *
   * Enquanto a resposta não chegou (`!ready`) não se esconde nada, senão o
   * módulo aparece e desaparece num piscar a cada navegação. Master vê tudo.
   */
  const unrestricted = !ready || isMaster;
  const visibleModules = (unrestricted ? MODULES : MODULES.filter((m) => grantsGroup(screenAccess, m.key)))
    .map((m) => ({
      ...m,
      items: unrestricted ? m.items : m.items.filter((i) => grantsSeg(screenAccess, m.key, i.seg)),
    }));

  const { open: gaveta } = useMobileNav();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside
      className={`rail-surface isolate flex h-dvh w-60 flex-col overflow-hidden px-3 py-4 transition-transform duration-200 lg:sticky lg:top-0 lg:shrink-0 lg:translate-x-0 ${
        /* 240px fixos num ecrã de 375 deixavam 135 para a tela inteira: abaixo
           de lg a barra sai da linha do layout e vira gaveta. */
        "fixed inset-y-0 left-0 z-50 " + (gaveta ? "translate-x-0" : "-translate-x-full")
      }`}
    >
      <RailWave />

      {/* Tudo que não é a onda fica acima dela. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <Link href="/" className="mb-2.5 flex items-center gap-2.5 px-1" title={MARCA.nome}>
          <img src="/logo.png" alt={MARCA.nome} className="h-8 w-8 shrink-0 rounded-[10px] shadow-brand" />
          <span>
            <span className="block font-display text-sm font-semibold leading-tight text-night-ink">{MARCA.nome}</span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.07em] text-night-muted">{MARCA.descritor}</span>
          </span>
        </Link>

        {/*
          Onde você está, e a porta de saída — as duas perguntas que este menu
          deixava sem resposta.

          Entrar num cliente troca o menu inteiro, e nada dizia que isso tinha
          acontecido: sobrava o logo, que leva para a home do escritório e não
          para a lista de onde a pessoa veio. Quem queria cadastrar um cliente
          ou abrir Configurações tinha que descobrir sozinho que o caminho era
          o logo — descoberta, não navegação.

          O botão é rotulado e fica ACIMA da identidade do cliente de propósito:
          lido de cima para baixo dá "saio daqui / estou nisto", que é a ordem
          em que a dúvida aparece.
        */}
        <div className="mb-3 rounded-xl bg-night-hover/[0.06] p-1.5">
          <Link
            href="/clients"
            className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-night-muted transition-colors hover:bg-night-hover/10 hover:text-night-ink"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" {...S} strokeWidth={2.2} />
            </svg>
            {t("client.allClients")}
          </Link>

          <div className="mt-1 flex items-center gap-2 px-1.5 pb-0.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-brand-400 to-brand-600 text-[10px] font-bold text-white shadow-brand">
              {client ? initials(client.name) : "—"}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold leading-tight text-night-ink">
                {client?.name ?? t("common.loading")}
              </span>
              <span className="block truncate font-mono text-[10px] text-night-muted">
                {client?.client_code ?? "—"}
              </span>
            </span>
          </div>
        </div>


        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          <Link href={base} className={`nav-item h-9 ${currentSeg === "" ? "nav-item-active" : ""}`}>
            <Icon><rect x="3" y="3" width="7" height="7" rx="1.5" {...S} /><rect x="14" y="3" width="7" height="7" rx="1.5" {...S} /><rect x="3" y="14" width="7" height="7" rx="1.5" {...S} /><rect x="14" y="14" width="7" height="7" rx="1.5" {...S} /></Icon>
            {t("client.tabDashboard")}
          </Link>

          <div className="px-2 pb-1 pt-3 text-[9.5px] font-medium uppercase tracking-[0.11em] text-night-muted">
            {t("modules.pick")}
          </div>

          {visibleModules.map((m) => {
            const open = activeModule?.key === m.key;
            const firstSeg = m.items[0]?.seg;
            const badge = m.key === "compras" && pendingInbox > 0 ? pendingInbox : null;
            return (
              <div key={m.key}>
                <Link
                  href={firstSeg ? `${base}/${firstSeg}` : base}
                  className={`nav-item h-9 ${open ? "nav-item-active" : ""}`}
                  aria-expanded={open}
                >
                  <Icon>{MODULE_ICONS[m.key]}</Icon>
                  {t(m.labelKey)}
                  {badge !== null && (
                    <span className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-semibold ${
                      open ? "bg-white/25 text-white" : "bg-brand-50 text-brand-700"
                    }`}>
                      {badge}
                    </span>
                  )}
                  <Chevron open={open} />
                </Link>
                {open && (
                  <div className="mb-1 mt-0.5 flex flex-col gap-px">
                    {m.items.map((item) => (
                      <Link
                        key={item.seg}
                        href={`${base}/${item.seg}`}
                        className={`rail-sub ${currentSeg === item.seg ? "rail-sub-active" : ""}`}
                      >
                        {t(item.key)}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Respiro: mantém o menu no alto e deixa o pé livre para a onda. */}
          <div className="min-h-[150px] flex-1" />
        </nav>

        {/* O tema subiu para a barra do topo, que está em toda tela — aqui
            embaixo sobrou só sair, que é ação desta barra. */}

        <button
          onClick={signOut}
          className="nav-item h-9 w-full"
          title={t("nav.signOut")}
        >
          <Icon><path d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" {...S} /></Icon>
          {t("nav.signOut")}
        </button>
      </div>
    </aside>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}
