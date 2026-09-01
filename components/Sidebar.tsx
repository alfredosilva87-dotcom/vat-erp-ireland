"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentClient, type CurrentClient } from "@/lib/currentClient";
import { useT } from "@/lib/i18n";
import type { TKey } from "@/lib/i18n";
import { usePermissions } from "@/components/PermissionScope";
import { grantsScreen, HR_SCREENS } from "@/lib/permissions";
import RailWave from "@/components/RailWave";
import { MARCA } from "@/lib/marca";
import { useMobileNav } from "@/components/MobileNav";

/**
 * O menu geral, em dois níveis.
 *
 * `perm` casa com um id da árvore de permissões (lib/permissions.ts). Item sem
 * `perm` seria item que ninguém consegue tirar de ninguém — por isso todos têm.
 *
 * A hierarquia não é enfeite: oito itens soltos no topo faziam a barra passar
 * da altura da tela e cobrir o tema, o recolher e o sair. E três desses oito
 * eram, na prática, dependentes de outro:
 *
 *   - **Caixa de entrada** é o que chegou por e-mail e telefone esperando
 *     leitura. Ao lado de "Analisar" pareciam duas rotinas concorrentes; são a
 *     mesma coisa em dois momentos — o que chegou, e o que se faz com ele.
 *   - **Itens** e **Base de alíquotas** são consulta de cadastro, não rotina
 *     de trabalho. Vivem sob "Base de dados", que é onde alguém procura.
 *
 * `null` em `icon` no filho é proposital: o segundo nível não tem ícone, igual
 * ao menu de dentro do cliente (components/ModuleSidebar.tsx).
 */
type NavChild = { href: string; key: TKey; perm: string };
type NavEntry = {
  href: string; key: TKey; icon: () => JSX.Element; perm: string; children?: NavChild[];
};

const NAV: NavEntry[] = [
  { href: "/", key: "nav.dashboard", icon: IconGrid, perm: "geral.home" },
  { href: "/clients", key: "nav.clients", icon: IconUsers, perm: "geral.clients" },
  {
    href: "/analyze", key: "nav.analyze", icon: IconScan, perm: "geral.analyze",
    children: [{ href: "/inbox", key: "nav.inbox", perm: "geral.inbox" }],
  },
  {
    href: "/records", key: "nav.database", icon: IconStack, perm: "geral.records",
    children: [
      { href: "/items", key: "nav.items", perm: "geral.items" },
      { href: "/base", key: "nav.rateBase", perm: "geral.base" },
      { href: "/chart", key: "nav.chart", perm: "geral.chart" },
      { href: "/charges", key: "nav.charges", perm: "geral.charges" },
    ],
  },
  /*
   * A agenda fiscal fica no menu GERAL, e não dentro de um cliente.
   *
   * A pergunta que ela responde é "em que cliente tenho de mexer hoje?" — e
   * essa não se faz de dentro de um cliente, faz-se antes de escolher um.
   */
  { href: "/obligations", key: "nav.obligations", icon: IconCalendar, perm: "geral.obligations" },
  {
    href: "/hr", key: "hr.title", icon: IconPeople, perm: "rh.painel",
    // A folha de uma empresa fica de fora: chega-se a ela pelo botão de cada
    // empresa, e um link para "a folha" sem dizer de quem não leva a lado nenhum.
    children: HR_SCREENS.filter((sc) => sc.id !== "rh.painel" && sc.id !== "rh.folha")
      .map((sc) => ({ href: sc.href!, key: sc.labelKey, perm: sc.id })),
  },
  { href: "/settings", key: "nav.settings", icon: IconCog, perm: "geral.settings" },
];

const COLLAPSE_KEY = "vat-sidebar-collapsed";

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useT();
  const [client, setClient] = useState<CurrentClient>(null);
  const { ready, isMaster, screenAccess } = usePermissions();
  const { open: gaveta } = useMobileNav();
  // Undefined until read from storage, so the first paint doesn't flash the
  // wrong width.
  const [collapsed, setCollapsed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const read = () => setClient(getCurrentClient());
    read();
    window.addEventListener("current-client-changed", read);
    return () => window.removeEventListener("current-client-changed", read);
  }, []);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      setCollapsed(false);
    }
  }, []);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* private mode — the choice just won't persist */
    }
  }

  // `open` drives the labels; while the preference is still unknown we keep
  // the responsive default (hidden under lg) to avoid a layout jump.
  const open = collapsed === false;

  /*
   * Enquanto a permissão não chegou não se esconde nada, senão o menu aparece
   * e encolhe a cada navegação. Master vê tudo.
   */
  const pode = (perm: string) => !ready || isMaster || grantsScreen(screenAccess, perm);

  /*
   * Um grupo continua no menu enquanto sobrar UM filho, mesmo que o pai tenha
   * sido tirado: quem pode ver a caixa de entrada mas não a leitura de
   * documentos precisa de um caminho até ela. Nesse caso o pai deixa de ser
   * link para a própria tela e passa a apontar para o primeiro filho visível.
   */
  const entradas = NAV
    .map((n) => ({ ...n, filhos: (n.children ?? []).filter((c) => pode(c.perm)) }))
    .filter((n) => pode(n.perm) || n.filhos.length > 0);
  /*
   * No telefone a barra é gaveta de 16rem — recolhida a ícones não serviria
   * para nada, então o rótulo aparece sempre e só some no desktop recolhido.
   */
  const showLabel = open || collapsed === undefined ? "block" : "block lg:hidden";

  return (
    <aside
      className={`rail-surface isolate flex h-dvh flex-col overflow-hidden px-3 py-5 transition-transform duration-200 lg:sticky lg:top-0 lg:shrink-0 lg:translate-x-0 lg:transition-[width] ${
        /* Abaixo de lg é gaveta por cima do conteúdo; de lg para cima volta a
           ser coluna do layout, com a largura que a preferência mandar. */
        "fixed inset-y-0 left-0 z-50 w-64 " + (gaveta ? "translate-x-0" : "-translate-x-full")
      } ${
        collapsed === undefined ? "lg:w-64" : open ? "lg:w-64" : "lg:w-[68px]"
      }`}
    >
      <RailWave />

      {/* Conteudo acima da onda. */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      {/* Brand */}
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-1" title={MARCA.nome}>
        <img src="/logo.png" alt={MARCA.nome} className="h-9 w-9 shrink-0 rounded-xl shadow-brand" />
        <span className={showLabel}>
          <span className="block font-display text-lg font-semibold leading-none text-night-ink">
            {MARCA.nome}
          </span>
          <span className="block text-[11px] font-medium tracking-wide text-night-muted">
            {MARCA.descritor}
          </span>
        </span>
      </Link>

      {/*
        Nav.

        `min-h-0` + `overflow-y-auto` são o que impede o menu de cobrir o
        rodapé: sem eles o `flex-1` cresce além da barra e o tema, o recolher e
        o sair ficam por baixo dos itens. Aparecia só com um grupo ABERTO, que
        é justamente quando ninguém está a olhar para o pé da barra.
      */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {entradas.map((n) => {
          const Icon = n.icon;
          const temFilhos = n.filhos.length > 0;
          const aberto = temFilhos &&
            (pathname === n.href || pathname.startsWith(n.href + "/") ||
             n.filhos.some((c) => pathname === c.href || pathname.startsWith(c.href + "/")));
          const proprio = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          // Pai sem permissão própria aponta para o primeiro filho visível.
          const destino = pode(n.perm) ? n.href : n.filhos[0].href;
          const label = t(n.key);
          return (
            <div key={n.href}>
              <Link
                href={destino}
                className={`nav-item ${proprio || aberto ? "nav-item-active" : ""}`}
                title={label}
                aria-expanded={temFilhos ? aberto : undefined}
              >
                <Icon />
                <span className={`${showLabel} flex-1`}>{label}</span>
                {temFilhos && collapsed !== true && (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0 opacity-55" aria-hidden="true">
                    <path d={aberto ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"} {...S} strokeWidth={2} />
                  </svg>
                )}
              </Link>
              {/* As rotinas só aparecem com a barra aberta: a 68px não há
                  largura para o rótulo, e item sem rótulo não é navegação. */}
              {/* `collapsed !== true` e nao `open`: enquanto a preferencia nao
                  foi lida do armazenamento, `open` e false e os filhos piscavam
                  — apareciam um quadro depois do pai. O rotulo ja usa a mesma
                  regra em `showLabel`. */}
              {aberto && collapsed !== true && (
                <div className="mb-1 mt-0.5 flex flex-col gap-px">
                  {n.filhos.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      className={`rail-sub ${pathname.startsWith(c.href) ? "rail-sub-active" : ""}`}
                    >
                      {t(c.key)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {isMaster && (
          <Link
            href="/master"
            className={`nav-item ${pathname.startsWith("/master") ? "nav-item-active" : ""}`}
            title={t("master.title")}
          >
            <IconShield />
            <span className={showLabel}>{t("master.title")}</span>
          </Link>
        )}
      </nav>


      {/*
        O tema subiu para a barra do topo, junto de quem está logado: é
        controlo de ambiente, e não navegação. Aqui embaixo ficaram só as duas
        ações que são mesmo desta barra — recolher e sair.
      */}

      {/* Collapse / pin */}
      <button
        onClick={toggle}
        className="mt-2 hidden h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-night-muted transition-colors hover:bg-night-hover/8 hover:text-night-ink lg:flex"
        title={open ? t("nav.collapse") : t("nav.expand")}
        aria-label={open ? t("nav.collapse") : t("nav.expand")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" {...S} />
          <path d="M9 4v16" {...S} />
          {open ? <path d="M15.5 9.5 13 12l2.5 2.5" {...S} /> : <path d="M13 9.5 15.5 12 13 14.5" {...S} />}
        </svg>
        <span className={showLabel}>{t("nav.collapse")}</span>
      </button>

      <button
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        className="flex items-center gap-3 rounded-xl px-3 h-10 text-sm font-medium text-night-muted transition-colors hover:bg-night-hover/8 hover:text-night-ink"
        title={t("nav.signOut")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
          <path d="M15 12H4m0 0l4-4m-4 4l4 4M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" {...S} />
        </svg>
        <span className={showLabel}>{t("nav.signOut")}</span>
      </button>
      </div>
    </aside>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}

/* ---- icons (stroke 1.8) ----
   Só o primeiro nível do menu tem ícone. Os de Caixa de entrada, Itens e Base
   de alíquotas saíram junto com a promoção deles a filhos. */
function base(children: React.ReactNode) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
      {children}
    </svg>
  );
}
const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconGrid() { return base(<><rect x="3" y="3" width="7" height="7" rx="1.5" {...S} /><rect x="14" y="3" width="7" height="7" rx="1.5" {...S} /><rect x="3" y="14" width="7" height="7" rx="1.5" {...S} /><rect x="14" y="14" width="7" height="7" rx="1.5" {...S} /></>); }
function IconUsers() { return base(<><circle cx="9" cy="8" r="3.2" {...S} /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" {...S} /><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 20a5.5 5.5 0 0 0-2-4.3" {...S} /></>); }
function IconScan() { return base(<><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" {...S} /><path d="M7 12h10" {...S} /></>); }
function IconStack() { return base(<><path d="M12 3l9 5-9 5-9-5 9-5Z" {...S} /><path d="M3 12l9 5 9-5M3 16l9 5 9-5" {...S} /></>); }
// RH: duas pessoas, uma à frente da outra. Distinta do IconUsers de Clientes,
// que é a mesma ideia mas com a segunda figura só esboçada — de longe elas
// confundiam-se, e ficam uma por cima da outra na barra.
function IconPeople() { return base(<><circle cx="8.5" cy="8" r="3.2" {...S} /><path d="M3 20a5.5 5.5 0 0 1 11 0" {...S} /><path d="M16 5.4a3.2 3.2 0 0 1 0 5.2" {...S} /><path d="M18.2 20a5.5 5.5 0 0 0-2.2-4.4" {...S} /></>); }
function IconCalendar() { return base(<><rect x="3.5" y="5" width="17" height="15" rx="2.5" {...S} /><path d="M3.5 9.5h17" {...S} /><path d="M8 3.5v3M16 3.5v3" {...S} /><circle cx="9" cy="14" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r="1.1" fill="currentColor" stroke="none" /></>); }
function IconShield() { return base(<><path d="M12 3l7 3v5.5c0 4.2-2.9 7.9-7 8.9-4.1-1-7-4.7-7-8.9V6l7-3Z" {...S} /><path d="m9.5 12 1.8 1.8 3.4-3.6" {...S} /></>); }
function IconCog() { return base(<><circle cx="12" cy="12" r="3.2" {...S} /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03Z" {...S} /></>); }
