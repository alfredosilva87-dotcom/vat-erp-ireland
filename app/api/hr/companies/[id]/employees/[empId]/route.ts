import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { criticarFuncionario } from "@/lib/hr/funcionarioPuro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** O funcionário tem de ser DESTA empresa — senão o id do URL bastava para mexer noutra. */
async function meu(clientId: string, empId: string) {
  const { data } = await getServerSupabase().from("hr_employees")
    .select("id").eq("id", empId).eq("client_id", clientId).maybeSingle();
  return !!data;
}

export async function PATCH(
  req: NextRequest, { params }: { params: { id: string; empId: string } }
) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("user");
  if ("error" in guard) return guard.error;
  if (!(await meu(params.id, params.empId))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const critica = criticarFuncionario(body);
  if (!critica.ok) return NextResponse.json({ error: critica.erro }, { status: 400 });

  const sb = getServerSupabase();
  // `client_id` e `id` NUNCA vêm do corpo: aceitar um deles deixava mudar o
  // funcionário de empresa por um campo escondido no pedido.
  const { id, client_id, created_at, ...campos } = critica.limpo as any;
  const { data, error } = await sb.from("hr_employees")
    .update({ ...campos, updated_at: new Date().toISOString() })
    .eq("id", params.empId).eq("client_id", params.id)
    .select("*").single();

  if (error) {
    if (/idx_hr_emp_pps_por_cliente/.test(error.message)) {
      return NextResponse.json(
        { error: "Ja existe outro funcionario com este PPS nesta empresa." }, { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ employee: data, avisos: critica.avisos });
}

/**
 * APAGAR. Admin, e só quem nunca teve horas lançadas.
 *
 * Apagar leva as horas em cascata, e horas apagadas são folha reescrita — o
 * payslip que já saiu deixa de ter de onde vir. Quem já trabalhou **desactiva-se**
 * (`active = false`): sai das folhas seguintes e o passado fica de pé.
 */
export async function DELETE(
  _req: NextRequest, { params }: { params: { id: string; empId: string } }
) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  if (!(await meu(params.id, params.empId))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const sb = getServerSupabase();
  const { count } = await sb.from("hr_employee_hours")
    .select("id", { count: "exact", head: true }).eq("employee_id", params.empId);
  if ((count ?? 0) > 0) {
    return NextResponse.json({
      error: `Este funcionario tem ${count} semana(s) de horas lancadas. `
        + "Desactive-o em vez de o apagar: sai das folhas seguintes e o que ja foi pago fica de pe.",
    }, { status: 409 });
  }

  const { error } = await sb.from("hr_employees")
    .delete().eq("id", params.empId).eq("client_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
