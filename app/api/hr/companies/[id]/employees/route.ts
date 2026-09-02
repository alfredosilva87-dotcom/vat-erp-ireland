import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { criticarFuncionario } from "@/lib/hr/funcionarioPuro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CRIAR funcionário — a rota que não existia.
 *
 * Até aqui o módulo de RH só lia: não havia `POST` de funcionário em lado
 * nenhum, e quem semeava era SQL directo. Enquanto foi assim, o escritório não
 * conseguia admitir ninguém pelo produto.
 *
 * A crítica das invariantes vive em `lib/hr/funcionarioPuro.ts`, sem banco.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("user");
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const critica = criticarFuncionario(body);
  if (!critica.ok) return NextResponse.json({ error: critica.erro }, { status: 400 });

  const sb = getServerSupabase();

  /*
   * O BLOCO tem de estar ligado na empresa.
   *
   * Criar alguém "mensal" numa empresa que só corre semanal produz um
   * funcionário que nunca aparece em folha nenhuma — existe no cadastro e não
   * existe em lado nenhum, que é o pior tipo de registo fantasma.
   */
  const { data: cfg } = await sb.from("hr_client_config")
    .select("freq_type").eq("client_id", params.id);
  const configurados = ((cfg ?? []) as any[]).map((c) => c.freq_type);
  // Empresa ainda sem configuracao nenhuma nao se bloqueia: e o estado de quem
  // acabou de ser cadastrada, e recusar ali obrigava a uma ordem que ninguem
  // adivinha. So se recusa quando HA configuracao e este bloco nao esta nela.
  if (configurados.length && !configurados.includes(critica.limpo.freq_type)) {
    return NextResponse.json({
      error: `Esta empresa nao corre payslip ${critica.limpo.freq_type}. `
        + "Ligue esse tipo no cadastro da empresa primeiro, senao a pessoa nunca entra em folha.",
    }, { status: 400 });
  }

  const { data, error } = await sb.from("hr_employees")
    .insert({ ...critica.limpo, client_id: params.id })
    .select("*").single();

  if (error) {
    // O índice único é por empresa: a mesma pessoa PODE trabalhar para dois
    // clientes do escritório, e trabalha. Duplicar dentro da mesma é que é erro.
    if (/idx_hr_emp_pps_por_cliente/.test(error.message)) {
      return NextResponse.json(
        { error: "Ja existe um funcionario com este PPS nesta empresa." }, { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ employee: data, avisos: critica.avisos });
}
