import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A folha de UMA empresa: quadro, horas do ano e feriados no banco.
 *
 * Devolve os dados crus e não os números prontos — o cálculo mora em
 * `lib/hr/payroll.ts`, que é testado sozinho. Se o bruto fosse somado aqui, a
 * conta passaria a existir em dois sítios (aqui e na tela que edita antes de
 * gravar), e duas cópias da mesma conta acabam sempre por discordar.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const year = Number(new URL(req.url).searchParams.get("year")) || new Date().getFullYear();
  const sb = getServerSupabase();

  const { data: client } = await sb
    .from("clients")
    .select("id,client_code,name,status,contact_person,email,phone")
    .eq("id", params.id)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: cfg } = await sb
    .from("hr_client").select("*").eq("client_id", params.id).maybeSingle();
  const { data: blocos } = await sb
    .from("hr_client_config").select("*").eq("client_id", params.id);
  const { data: employees } = await sb
    .from("hr_employees").select("*").eq("client_id", params.id).order("first_name");

  const ids = ((employees ?? []) as any[]).map((e) => e.id);
  const [{ data: hours }, { data: bankHolidays }] = await Promise.all([
    ids.length
      ? sb.from("hr_employee_hours").select("*").eq("year", year).in("employee_id", ids)
      : Promise.resolve({ data: [] as any[] }),
    ids.length
      ? sb.from("hr_bank_holiday_entries").select("*").eq("year", year).in("employee_id", ids)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  return NextResponse.json({
    client,
    config: cfg ?? null,
    blocks: blocos ?? [],
    employees: employees ?? [],
    hours: hours ?? [],
    bankHolidays: bankHolidays ?? [],
    year,
  });
}

/**
 * A CONFIGURAÇÃO DE FOLHA da empresa — por enquanto, só o recibo.
 *
 * `upsert` e não `update` porque a maior parte das empresas ainda não tem linha
 * em `hr_client`: com `update`, ligar a opção numa empresa nova não dava erro
 * nenhum e também não gravava nada — o pior dos dois mundos.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const corpo = await req.json().catch(() => ({}));
  const campos: Record<string, unknown> = {};
  if (typeof corpo?.payslip_show_hours === "boolean") {
    campos.payslip_show_hours = corpo.payslip_show_hours;
  }
  if (!Object.keys(campos).length) {
    return NextResponse.json({ error: "Nada para gravar." }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { error } = await sb.from("hr_client")
    .upsert({ client_id: params.id, ...campos, updated_at: new Date().toISOString() },
      { onConflict: "client_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
