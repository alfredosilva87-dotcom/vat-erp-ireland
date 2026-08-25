import { NextRequest, NextResponse } from "next/server";
import { visibleClientIds } from "@/lib/access";
import { listPayrollCompanies } from "@/lib/hr/store";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: uma semana que volta desatualizada
// num controlo de folha nao e lentidao evitada, e payslip enviado duas vezes.
export const dynamic = "force-dynamic";

/**
 * As empresas que fazem folha, com configuração e o ano inteiro de semanas.
 *
 * Rota de LISTA: não recebe id no caminho, então não há o que comparar — o
 * escopo vem de `visibleClientIds()`, o mesmo guarda que as outras listas do
 * ERP usam. Sem ele, `GET /api/hr/companies` devolveria a folha de todos os
 * escritórios da instalação.
 */
export async function GET(req: NextRequest) {
  const allowed = await visibleClientIds();
  // `visibleClientIds` devolve a lista, `null` (master vê tudo), ou a recusa.
  if (allowed !== null && !Array.isArray(allowed)) return allowed.error;

  const year = Number(new URL(req.url).searchParams.get("year")) || new Date().getFullYear();
  return NextResponse.json({
    companies: await listPayrollCompanies(allowed, year),
    year,
  });
}
