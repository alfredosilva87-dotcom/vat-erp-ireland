import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O HISTÓRICO DE RECIBOS — o que já se pagou, e como.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ISTO PRECISOU DE UMA ROTA NOVA
 *
 * `hr_payslip` estava gravada desde sempre — com o bruto, o imposto, o
 * acumulado, o cut-off usado, a base e os avisos de cada período. Só que a
 * única maneira de a ver era pedir o PDF de UM período: não havia nada que
 * respondesse a "o que é que esta empresa pagou este ano?".
 *
 * Ou seja: o dado existia e não tinha porta. Quem quisesse comparar Setembro com
 * Agosto abria dois PDFs.
 *
 * ---------------------------------------------------------------------------
 * O QUE VAI JUNTO, E PORQUÊ
 *
 * O `cutoff_used`, os `credits_used`, a `basis` e o `tax_year_used` viajam com
 * cada linha. São eles que respondem a "porque é que esta semana reteve tanto?"
 * — a pergunta que aparece meses depois, quando já ninguém se lembra do estado
 * das tabelas naquele dia. Sem eles o histórico seria uma lista de totais, e
 * uma lista de totais não se confere.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const q = req.nextUrl.searchParams;
  const year = Number(q.get("year")) || new Date().getFullYear();
  const employeeId = q.get("employee");

  const sb = getServerSupabase();

  let pergunta = sb.from("hr_payslip")
    .select(
      "id,employee_id,year,period_no,freq_type,pay_date,gross_cents,paye_cents,usc_cents,"
      + "prsi_ee_cents,prsi_er_cents,net_cents,cum_gross_cents,cum_paye_cents,"
      + "cutoff_used_cents,credits_used_cents,basis,tax_year_used,table_confirmed,"
      + "warnings,status,finalised_at"
    )
    .eq("client_id", params.id)
    .eq("year", year)
    // Do mais recente para o mais antigo: quem abre o histórico quer o último.
    .order("period_no", { ascending: false });

  if (employeeId) pergunta = pergunta.eq("employee_id", employeeId);

  /*
   * O LIMITE É EXPLÍCITO.
   *
   * O PostgREST corta em 1000 sem avisar — já mordeu este produto antes, num
   * relatório que simplesmente deixava linhas de fora e continuava a somar. Uma
   * empresa com 50 pessoas e 53 semanas dá 2650 recibos num ano, portanto o
   * corte é alcançável. Pede-se mais um do que se mostra, para saber que há.
   */
  const MAX = 2000;
  const { data, error } = await pergunta.limit(MAX + 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const linhas = (data ?? []) as any[];
  const truncado = linhas.length > MAX;
  if (truncado) linhas.length = MAX;

  const ids = Array.from(new Set(linhas.map((l) => l.employee_id)));
  const { data: emps } = ids.length
    ? await sb.from("hr_employees").select("id,first_name,surname").in("id", ids)
    : { data: [] as any[] };
  const nomes = new Map(
    ((emps ?? []) as any[]).map((e) => [e.id, [e.first_name, e.surname].filter(Boolean).join(" ")])
  );

  return NextResponse.json({
    year,
    truncado,
    linhas: linhas.map((l) => ({ ...l, nome: nomes.get(l.employee_id) ?? "—" })),
  });
}
