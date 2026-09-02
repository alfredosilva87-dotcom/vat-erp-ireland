import { NextRequest, NextResponse } from "next/server";
import { visibleClientIds, requireClient, denied } from "@/lib/access";
import { requireRole, getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { currentIsoWeek } from "@/lib/hr/payroll";
import { listPayrollCompanies, listClientsOffPayroll } from "@/lib/hr/store";

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
  const [companies, foraDaFolha] = await Promise.all([
    listPayrollCompanies(allowed, year),
    listClientsOffPayroll(allowed),
  ]);
  return NextResponse.json({ companies, foraDaFolha, year });
}

const BLOCOS = ["weekly", "fortnightly", "monthly"] as const;

/**
 * PÔR UMA EMPRESA NA FOLHA — a acção que não existia.
 *
 * Sem linha em `hr_client` a empresa não aparece no módulo, e nada no produto
 * criava essa linha: quem semeava era SQL. Era o mesmo buraco dos funcionários
 * antes da migração 049, com um sintoma pior — a lista aparecia vazia e não
 * havia erro nenhum a apontar a causa.
 */
export async function POST(req: NextRequest) {
  const corpo = await req.json().catch(() => ({}));
  const clientId = String(corpo?.clientId || "");
  if (!clientId) return NextResponse.json({ error: "Falta a empresa." }, { status: 400 });

  // O guarda por empresa, e não `visibleClientIds`: aqui há um id no pedido.
  const acesso = await requireClient(clientId);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const escolhidos = Array.isArray(corpo?.blocos)
    ? corpo.blocos.filter((b: any) => BLOCOS.includes(b))
    : [];
  if (!escolhidos.length) {
    // Uma empresa sem bloco nenhum entra na lista e não corre folha nenhuma —
    // um estado que só serve para confundir quem a for procurar.
    return NextResponse.json(
      { error: "Escolha pelo menos um tipo de payslip." }, { status: 400 }
    );
  }

  const sb = getServerSupabase();
  const user = await getSessionUser();

  const { error } = await sb.from("hr_client").upsert({
    client_id: clientId,
    freq_weekly: escolhidos.includes("weekly"),
    freq_fortnightly: escolhidos.includes("fortnightly"),
    freq_monthly: escolhidos.includes("monthly"),
    updated_by: user?.id ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  /*
   * O CONTROLO SEMANAL COMEÇA AGORA, e não em Janeiro.
   *
   * `tracked_year`/`tracked_week` existem exactamente para isto (ver a migração
   * 018): uma empresa que entra em Setembro não deve aparecer a dever 35
   * semanas de payslips que ou saíram por fora, ou não existiram. Um painel que
   * abre com 35 alarmes falsos é um painel que se aprende a ignorar.
   */
  const agora = new Date();
  const linhas = escolhidos.map((freq: string) => ({
    client_id: clientId, freq_type: freq,
    tracked_year: agora.getFullYear(), tracked_week: currentIsoWeek(agora),
    updated_by: user?.id ?? null, updated_at: agora.toISOString(),
  }));
  const { error: e2 } = await sb.from("hr_client_config")
    .upsert(linhas, { onConflict: "client_id,freq_type" });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
