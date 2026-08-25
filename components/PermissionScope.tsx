"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Quem é a sessão — buscado UMA vez para o app inteiro.
 *
 * Antes cada peça chamava `/api/auth/me` por conta própria (o menu geral, o
 * menu de módulo, a trava de tela). Três respostas para a mesma pergunta
 * chegam em ordens diferentes, e é assim que um item do menu pisca antes de
 * sumir. Aqui a resposta é uma só.
 *
 * O contexto passou a carregar a resposta INTEIRA — utilizador e empresa — e
 * não só o que a trava de tela precisava. Enquanto expunha apenas `role` e
 * `screenAccess`, a barra do topo e o aviso de licença continuavam a buscar a
 * própria cópia: três pedidos idênticos por navegação, cada um com duas idas
 * ao banco. Era o grosso da sensação de que o sistema trava ao mudar de tela.
 *
 * `ready` importa: enquanto a resposta não chegou não se esconde NADA. Um menu
 * que aparece e encolhe é feio; uma tela que dá "sem permissão" por meio
 * segundo a cada navegação faz o usuário achar que perdeu o acesso.
 */

export type SessionUser = {
  id: string; email: string; name: string | null; role: string;
  company_id: string | null; company_slug: string | null; company_name: string | null;
  screen_access: string[] | null;
  surname?: string | null; phone?: string | null; avatar?: string | null;
};

export type SessionCompany = {
  name: string; active: boolean; license_expires_at: string | null;
};
export type Permissions = {
  ready: boolean;
  isMaster: boolean;
  /** `null` = sem restrição. Ids de tela — ver lib/permissions.ts. */
  screenAccess: string[] | null;
  role: string | null;
  user: SessionUser | null;
  company: SessionCompany | null;
};

const VAZIO: Permissions = {
  ready: false, isMaster: false, screenAccess: null, role: null,
  user: null, company: null,
};

const Ctx = createContext<Permissions>(VAZIO);

export const usePermissions = () => useContext(Ctx);
/** O mesmo contexto, com o nome que faz sentido para quem quer o utilizador. */
export const useSession = () => useContext(Ctx);

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const [perm, setPerm] = useState<Permissions>(VAZIO);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setPerm({
          ready: true,
          isMaster: d.user?.role === "master",
          screenAccess: d.user?.screen_access ?? null,
          role: d.user?.role ?? null,
          user: d.user ?? null,
          company: d.company ?? null,
        });
      })
      // Falha de rede não pode trancar ninguém para fora: sem resposta, sem
      // restrição. Quem não tem sessão já foi barrado no middleware.
      .catch(() => alive && setPerm((p) => ({ ...p, ready: true })));
    return () => { alive = false; };
  }, []);

  return <Ctx.Provider value={perm}>{children}</Ctx.Provider>;
}
