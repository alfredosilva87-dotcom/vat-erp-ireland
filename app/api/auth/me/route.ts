import { NextResponse } from "next/server";
import { createSession, getSessionUser } from "@/lib/auth";
import { hasSupabaseConfig, getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

// Company license fields are read fresh on every call rather than trusted
// from the JWT — the licence can be renewed or revoked at any point during
// the 7-day session, and the alert banner needs to reflect that immediately.
// screen_access follows the same rule: an admin changing someone's screen
// permissions should take effect on their next click, not their next login.
/**
 * Tipo com nome próprio, e não `typeof company`.
 *
 * `typeof company` estreitava para `null` (a variável nasce nula), e o cast
 * apagava os campos — o compilador passou a ver `never` e recusou ler a
 * validade da licença logo abaixo.
 */
type EmpresaDaSessao = { name: string; active: boolean; license_expires_at: string | null };

export async function GET() {
  const user = await getSessionUser();
  let company: EmpresaDaSessao | null = null;
  let screen_access: string[] | null = null;
  let papelDaResposta: string | null = null;
  let perfil: { surname: string | null; phone: string | null; avatar: string | null } | null = null;
  if (user && hasSupabaseConfig()) {
    /*
     * As duas consultas em PARALELO, e nao uma a seguir a outra.
     *
     * Nao dependem uma da outra, e esta rota e a mais chamada do sistema —
     * monta em toda tela. Em serie, cada navegacao pagava as duas idas ao
     * banco somadas; lado a lado paga a mais lenta.
     */
    const sb = getServerSupabase();
    const [empresa, appUser] = await Promise.all([
      user.company_id
        ? sb.from("companies").select("name, active, license_expires_at")
            .eq("id", user.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sb.from("app_users").select("role,screen_access,surname,phone,avatar")
        .eq("id", user.id).maybeSingle(),
    ]);
    company = ((empresa as any).data as EmpresaDaSessao | null) ?? null;

    /*
     * O token guarda a validade da licença; o banco é a verdade.
     *
     * Quando divergem, a sessão é reemitida aqui. É o que faz uma renovação
     * valer no clique seguinte em vez de só no próximo login — e, no outro
     * sentido, o que impede uma licença cancelada de continuar a valer sete
     * dias porque o token dizia o contrário.
     *
     * Esta rota serve para isso melhor do que qualquer outra: toda tela a
     * chama, e é a única que já lê a empresa do banco de qualquer maneira.
     */
    const noBanco = company?.license_expires_at ?? null;
    const papelNoBanco = ((appUser.data as any)?.role as string | undefined) ?? user.role;
    if ((user.licenseExpiresAt ?? null) !== noBanco || papelNoBanco !== user.role) {
      /*
       * O PAPEL também é reemitido quando diverge, e não só a licença.
       *
       * Ele viajava no token e mais nada o atualizava: promover alguém a
       * `master` não valia até ela sair e entrar, e — o que importa de verdade
       * — REBAIXAR alguém também não. Um administrador despromovido continuava
       * a poder apagar clientes durante os sete dias de vida da sessão, e
       * ninguém percebia, porque a tela dele deixava de mostrar os botões.
       */
      await createSession({ ...user, role: papelNoBanco, licenseExpiresAt: noBanco });
    }
    const linha = appUser.data as
      { role: string | null; screen_access: string[] | null; surname: string | null;
        phone: string | null; avatar: string | null } | null;
    screen_access = linha?.screen_access ?? null;
    papelDaResposta = linha?.role ?? null;
    perfil = linha
      ? { surname: linha.surname, phone: linha.phone, avatar: linha.avatar }
      : null;
  }
  return NextResponse.json({
    user: user ? { ...user, role: papelDaResposta ?? user.role, screen_access, ...(perfil ?? {}) } : null,
    company,
  });
}
