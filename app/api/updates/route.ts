import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { verificarAtualizacao, VERSAO_INSTALADA } from "@/lib/atualizacoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Há versão nova?
 *
 * Quem fala com o GitHub é o SERVIDOR, e é por isso que esta rota existe em vez
 * de a tela perguntar directamente: o token é de leitura do repositório privado
 * inteiro, e um token que chega ao navegador é um token publicado.
 *
 * `?forcar=1` salta a cache de uma hora — serve o botão "verificar agora", que
 * é o que se carrega logo a seguir a actualizar para confirmar que resultou.
 */
export async function GET(req: NextRequest) {
  // Qualquer utilizador com sessão pode ver que há actualização: quem trabalha
  // com o sistema é quem repara que ele está parado numa versão antiga, e
  // esconder isso do operador não protege nada.
  const guard = await requireRole("user");
  if ("error" in guard) return guard.error;

  const forcar = new URL(req.url).searchParams.get("forcar") === "1";
  const r = await verificarAtualizacao(forcar);
  return NextResponse.json({ ...r, versaoInstalada: VERSAO_INSTALADA });
}
