"use client";

import { useEffect } from "react";
import { setCurrentClient } from "@/lib/currentClient";

/**
 * Entrar no RH larga o cliente que estava selecionado.
 *
 * As telas daqui são do ESCRITÓRIO: o painel, o controlo semanal e a
 * comunicação olham as 35 empresas de uma vez. Com um cliente ainda ativo por
 * baixo, a barra do topo dizia "AL Beauty" enquanto a tela somava a folha de
 * toda a gente — e a única coisa pior do que um número errado é um número
 * certo com o rótulo errado.
 *
 * Limpar na ENTRADA, e não na saída, porque é a entrada que a pessoa vê: ela
 * clica em Recursos Humanos e a barra do topo responde na mesma ação. A folha
 * de uma empresa (`/hr/companies/[id]`) diz de quem é no próprio cabeçalho,
 * que é o lugar certo — ali o escopo é da tela, não da sessão.
 */
export default function HrLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setCurrentClient(null);
  }, []);

  return <>{children}</>;
}
