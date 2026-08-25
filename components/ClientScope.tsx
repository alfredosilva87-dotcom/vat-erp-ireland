"use client";

/**
 * Em que cliente a tela atual está, mesmo fora de `/clients/[id]/...`.
 *
 * A tela de revisão de uma nota (`/invoice/[id]`) é dado de UM cliente, mas a
 * rota não diz isso — e o menu lateral, que decide olhando a URL, caía no menu
 * geral. Na prática: a pessoa abre um documento de dentro do módulo Compras,
 * e o menu do módulo some embaixo dela.
 *
 * Duas fontes, nesta ordem, porque uma sozinha não cobre:
 *   1. `?from=/clients/<id>/...` — chega junto com o clique, então o menu
 *      certo aparece já no primeiro quadro, sem piscar o menu errado;
 *   2. o que a própria tela publica quando carrega a nota — cobre quem colou
 *      a URL direto ou voltou por um favorito, onde não há `from`.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type Ctx = {
  /** O cliente da tela atual, ou null quando ela não é de um cliente só. */
  clientId: string | null;
  /** A tela avisa em que cliente ela está. Ignorado quando a URL já disse. */
  publish: (id: string | null) => void;
};

const ClientScopeContext = createContext<Ctx>({ clientId: null, publish: () => {} });

export function ClientScopeProvider({
  fromUrl,
  children,
}: {
  /** O que a URL já sabe (caminho ou `from`); manda sobre o que a tela publica. */
  fromUrl: string | null;
  children: React.ReactNode;
}) {
  const [published, setPublished] = useState<string | null>(null);

  // Trocou de tela e a nova não publicou nada ainda: esquece o cliente
  // anterior, senão o menu de um cliente fica preso numa tela de outro.
  useEffect(() => {
    if (fromUrl) setPublished(null);
  }, [fromUrl]);

  const publish = useCallback((id: string | null) => {
    setPublished((prev) => (prev === id ? prev : id));
  }, []);

  const value = useMemo(
    () => ({ clientId: fromUrl ?? published, publish }),
    [fromUrl, published, publish]
  );

  return <ClientScopeContext.Provider value={value}>{children}</ClientScopeContext.Provider>;
}

export function useClientScope() {
  return useContext(ClientScopeContext);
}

/**
 * Para a tela dizer de que cliente ela é.
 *
 * Hook em vez de `publish()` solto no corpo do componente porque publicar
 * durante a renderização atualiza o pai no meio do render — o React reclama e,
 * pior, entra em laço quando o id muda a cada volta.
 */
export function usePublishClientScope(clientId: string | null | undefined) {
  const { publish } = useClientScope();
  useEffect(() => {
    publish(clientId ?? null);
  }, [clientId, publish]);
}
