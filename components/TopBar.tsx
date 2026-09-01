"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getCurrentClient, setCurrentClient, type CurrentClient } from "@/lib/currentClient";
import type { Client } from "@/lib/types";
import { getExercise, setExercise, exerciseOptions, EXERCISE_EVENT } from "@/lib/exercise";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import ThemeToggleButton from "@/components/ThemeToggleButton";
import { useSession } from "@/components/PermissionScope";
import { useMobileNav } from "@/components/MobileNav";

/**
 * A faixa do topo: exercício fiscal, empresa ativa e quem está logado.
 *
 * O exercício mora aqui porque é estado do TRABALHO, não de uma tela: quem
 * está fechando 2025 continua em 2025 ao pular do painel para as obrigações.
 * Antes cada tela tinha o seu, e o ano se perdia na troca de rotina.
 */
export default function TopBar() {
  const { t } = useT();
  const { setOpen: abrirMenu } = useMobileNav();
  const sessao = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [clients, setClients] = useState<Client[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [client, setClient] = useState<CurrentClient>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  // Só depois de montar: ler localStorage no primeiro render dá diferença
  // entre servidor e cliente e o React reclama de hidratação.
  useEffect(() => {
    setYear(getExercise());
    const onYear = () => setYear(getExercise());
    window.addEventListener(EXERCISE_EVENT, onYear);
    return () => window.removeEventListener(EXERCISE_EVENT, onYear);
  }, []);

  useEffect(() => {
    const read = () => setClient(getCurrentClient());
    read();
    window.addEventListener("current-client-changed", read);
    return () => window.removeEventListener("current-client-changed", read);
  }, []);

  /*
   * Dentro do workspace de um cliente, a URL MANDA sobre o que está guardado.
   *
   * Sem isto a barra dizia "nenhum cliente selecionado" com a tela inteira
   * mostrando os dados de um — e é justamente essa faixa que a pessoa olha
   * para confirmar em qual empresa está lançando.
   */
  const clientIdInUrl = pathname.match(/^\/clients\/([^/]+)/)?.[1] ?? null;

  /*
   * Dentro do RH não há empresa ativa, e por isso não há seletor.
   *
   * Deixá-lo ali com "nenhum cliente" seria um controlo que não controla
   * nada — pior, escolher uma empresa nele voltaria a marcar seleção numa
   * área que existe justamente sem ela. Ver app/hr/layout.tsx.
   */
  const noRh = pathname === "/hr" || pathname.startsWith("/hr/");

  /*
   * O exercício fiscal só aparece nos PAINÉIS — o geral e o do cliente.
   *
   * Ele é um recorte para VER NÚMEROS, e só os painéis somam números por ano.
   * Nas telas de trabalho não tinha efeito nenhum: quem vai mexer numa nota ou
   * num lançamento de banco procura pela nota, não pelo ano, e um seletor que
   * não muda nada na tela em que está ensina a desconfiar dele.
   *
   * Enquanto ficou visível em toda parte, essa era a leitura correta de quem
   * usava: "não funciona".
   */
  const noPainel =
    pathname === "/" ||
    /^\/clients\/[^/]+(\/dashboard)?$/.test(pathname);
  const shown = clientIdInUrl
    ? clients.find((c) => c.id === clientIdInUrl) ?? null
    : client;

  /*
   * Há um cliente ativo, mas a tela atual não é dele.
   *
   * Acontece o tempo todo: estava-se dentro de uma empresa, clicou-se no plano
   * de contas geral (ou no RH, ou nos itens) e agora não há caminho de volta.
   * O seletor ao lado NÃO resolve — ele já mostra essa empresa, e escolher o
   * valor que já está escolhido não dispara evento nenhum. O controle parece
   * partido, e a única saída era Clientes → procurar → entrar outra vez.
   */
  const voltarPara = !clientIdInUrl && client ? client : null;

  /*
   * O utilizador vem do contexto, e não de um `fetch` próprio.
   *
   * Esta barra monta em TODA tela. Enquanto buscava `/api/auth/me` por conta
   * dela, cada navegação repetia um pedido que o `PermissionProvider` já tinha
   * feito — e que custa duas consultas ao banco.
   */
  useEffect(() => {
    setEmail(sessao.user?.email ?? null);
    setAvatar(sessao.user?.avatar ?? null);
  }, [sessao.user]);

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json())
      .then((d) => setClients(d.clients || [])).catch(() => {});
  }, []);

  /**
   * Troca a empresa ativa.
   *
   * Escolher uma empresa aqui LEVA à empresa — sempre.
   *
   * Antes só navegava se já se estivesse dentro de um cliente; fora dele
   * apenas trocava um contexto invisível, e o seletor ficava a anunciar uma
   * empresa sem que a tela mudasse. Um controle que promete trocar e não troca
   * é pior do que não existir.
   *
   * Dentro do workspace mantém-se a MESMA rotina da empresa nova — quem está
   * conferindo compras quer continuar em compras, não voltar ao painel. Fora
   * dele, entra pelo painel do cliente, que é a porta de casa. E "nenhum
   * cliente" sai para a lista.
   */
  function switchTo(id: string) {
    const next = clients.find((c) => c.id === id) ?? null;
    setCurrentClient(next ? { id: next.id, name: next.name, activity_code: next.activity_code } : null);
    if (!next) {
      router.push("/clients");
      return;
    }
    const inWorkspace = pathname.match(/^\/clients\/([^/]+)(\/.*)?$/);
    router.push(`/clients/${next.id}${inWorkspace ? inWorkspace[2] ?? "" : ""}`);
  }

  return (
    <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line bg-surface px-4 py-2.5 lg:flex-nowrap lg:gap-x-3 lg:px-5">
      {/*
        A porta da gaveta. Só existe abaixo de `lg`, onde a barra lateral saiu
        da linha do layout — no desktop ela está sempre à vista e um botão para
        a abrir seria um botão para nada.
      */}
      <button
        type="button"
        onClick={() => abrirMenu(true)}
        className="btn-ghost flex h-8 w-8 shrink-0 items-center justify-center px-0 lg:hidden"
        aria-label={t("nav.expand")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/*
        Era um `div` com o texto do placeholder dentro — parecia um campo, e
        não era. Agora busca de verdade: leva para a tela de resultados, que
        procura fornecedor, número de nota, cliente e item.
      */}
      <form
        className="order-last flex w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm focus-within:border-brand lg:order-none lg:w-auto lg:flex-1 lg:max-w-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const termo = busca.trim();
          if (termo.length < 2) return;
          /*
           * `from` guarda de onde a busca partiu, para a tela de resultados
           * ter uma porta de volta.
           *
           * Buscar sai do workspace do cliente e cai no painel geral — e sem
           * o caminho de origem, voltar significava escolher a empresa outra
           * vez. Uma busca não devia custar isso.
           */
          const from = encodeURIComponent(pathname);
          router.push(`/search?q=${encodeURIComponent(termo)}&from=${from}`);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-muted">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-ink placeholder:text-muted focus:outline-none"
          placeholder={t("nav.search")}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          aria-label={t("search.title")}
        />
      </form>

      <div className="ml-auto flex min-w-0 items-center gap-2 lg:gap-3">
        {noPainel && (
        <label className="flex shrink-0 flex-col leading-tight">
          <span className="whitespace-nowrap text-[9.5px] font-medium uppercase tracking-wide text-muted">
            {t("top.exercise")}
          </span>
          {/*
            Enquanto o ano não foi lido do armazenamento mostra em branco em
            vez de um palpite: piscar 2026 e trocar para 2025 faria duvidar de
            qual período a tela está mostrando.
          */}
          <select
            className="-ml-1 cursor-pointer border-0 bg-transparent p-0 pl-1 text-[13px] font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            value={year ?? ""}
            onChange={(e) => setExercise(Number(e.target.value))}
            aria-label={t("top.exercise")}
          >
            {year === null
              ? <option value="">—</option>
              : exerciseOptions().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        )}

        {noPainel && <span className="hidden h-7 w-px bg-line lg:block" aria-hidden="true" />}

        {/*
          Trocar de empresa AQUI, sem passar pela lista de clientes.
          Num escritório multiempresa a troca é gesto de minuto em minuto; ter
          de abrir a lista toda vez transformava uma escolha em uma viagem.
        */}
        {!noRh && (
        <label className="flex min-w-0 max-w-[34vw] flex-col leading-tight lg:max-w-[190px]">
          <span className="whitespace-nowrap text-[9.5px] font-medium uppercase tracking-wide text-muted">
            {t("top.company")}
          </span>
          <select
            className="-ml-1 w-full min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 pl-1 text-[13px] font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            value={shown?.id ?? ""}
            onChange={(e) => switchTo(e.target.value)}
            aria-label={t("top.company")}
          >
            <option value="">{t("nav.noClient")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.client_code} · {c.name}</option>
            ))}
          </select>
        </label>
        )}

        {/* O caminho de volta. Só aparece quando ele existe e falta. */}
        {!noRh && voltarPara && (
          <Link
            href={`/clients/${voltarPara.id}`}
            className="btn-ghost h-8 shrink-0 whitespace-nowrap px-2.5 text-xs"
            title={t("top.backToClient", { name: voltarPara.name })}
          >
            ← {t("top.backShort")}
          </Link>
        )}

        {!noRh && <span className="hidden h-7 w-px bg-line lg:block" aria-hidden="true" />}

        {/*
          O tema desceu do pé da barra lateral para cá.
          É controlo de AMBIENTE, e ambiente mora junto de quem está logado —
          embaixo ficaram só recolher e sair, que são ações da própria barra.
        */}
        <ThemeToggleButton />

        {/* O avatar deixou de ser enfeite: é a porta da conta. */}
        <Link
          href="/settings/profile"
          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand text-[11px] font-bold text-white transition-opacity hover:opacity-85"
          title={email ?? undefined}
          aria-label={t("profile.title")}
        >
          {avatar
            ? <img src={avatar} alt="" className="h-full w-full object-cover" />
            : (email ? email.slice(0, 2).toUpperCase() : "—")}
        </Link>
      </div>
    </header>
  );
}
