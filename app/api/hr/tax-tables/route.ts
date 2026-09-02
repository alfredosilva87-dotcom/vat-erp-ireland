import { NextRequest, NextResponse } from "next/server";
import { requireRole, getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { esquecerTabela } from "@/lib/hr/fiscal/tabelasDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * As tabelas fiscais — cadastro.
 *
 * Sem guarda de empresa de propósito: a lei irlandesa é a mesma para os 35
 * clientes do escritório. É referência global, como a base de alíquotas e o
 * plano de contas partilhado.
 */

export async function GET(req: NextRequest) {
  const guard = await requireRole("user");
  if ("error" in guard) return guard.error;

  const sb = getServerSupabase();
  const ano = Number(new URL(req.url).searchParams.get("year")) || new Date().getFullYear();

  const [{ data: anos }, { data: cab }, { data: bandas }, { data: prsi }, { data: ae }] =
    await Promise.all([
      sb.from("hr_tax_year").select("year,confirmed_at").order("year", { ascending: false }),
      sb.from("hr_tax_year").select("*").eq("year", ano).maybeSingle(),
      sb.from("hr_usc_band").select("*").eq("year", ano).order("ord", { ascending: true }),
      sb.from("hr_prsi_rate").select("*").eq("year", ano).order("effective_from", { ascending: true }),
      /*
       * A AE NAO se filtra pelo ano, e isso e de propósito.
       *
       * O auto-enrolment é uma escada de degraus com datas — 1,5% agora, 3% em
       * 2029, 4,5% em 2032, 6% em 2035 — e um degrau vale de lá para a frente.
       * Filtrar por ano dava uma tabela vazia em 2027 e 2028, e alguém
       * concluiria que a contribuição tinha acabado.
       */
      sb.from("hr_ae_rate").select("*").order("effective_from", { ascending: true }),
    ]);

  return NextResponse.json({
    anos: anos ?? [], ano, cabecalho: cab ?? null,
    bandas: bandas ?? [], prsi: prsi ?? [], ae: ae ?? [],
  });
}

/** Gravar. ADMIN: mexer numa taxa muda o líquido de toda a gente. */
export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const sb = getServerSupabase();
  const user = await getSessionUser();
  const body = await req.json().catch(() => ({}));
  const ano = Number(body?.year);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    return NextResponse.json({ error: "Ano invalido." }, { status: 400 });
  }

  const cab = body?.cabecalho ?? {};

  /*
   * VALIDA-SE ANTES DE ESCREVER, e a ordem importa.
   *
   * Antes, o `upsert` do cabecalho ia primeiro e esbarrava no NOT NULL do
   * banco — e o que chegava ao ecra era
   * `null value in column "cutoff_lone_parent_cents" violates not-null`.
   * Um nome de coluna nao diz a ninguem que campo ficou por preencher, e a
   * verificacao das linhas de PRSI, que vinha depois, nunca chegava a correr.
   */
  const OBRIGATORIOS: [string, string][] = [
    ["cutoff_single_cents", "Cut-off — single"],
    ["cutoff_lone_parent_cents", "Cut-off — lone parent"],
    ["cutoff_married_one_cents", "Cut-off — married, one income"],
    ["cutoff_married_two_cents", "Cut-off — married, two incomes"],
    ["cutoff_transfer_max_cents", "Cut-off — max transferable"],
    ["credit_personal_single_cents", "Credit — personal (single)"],
    ["credit_personal_married_cents", "Credit — personal (married)"],
    ["credit_employee_cents", "Credit — employee (PAYE)"],
    ["credit_lone_parent_cents", "Credit — lone parent"],
    ["emergency_weekly_cutoff_cents", "Emergency — weekly cut-off"],
    ["usc_exemption_annual_cents", "USC — annual exemption"],
    ["usc_reduced_limit_cents", "USC — reduced-rate ceiling"],
  ];
  const emFalta = OBRIGATORIOS.filter(([k]) => !Number.isFinite(Number(cab?.[k])));
  if (emFalta.length) {
    return NextResponse.json(
      { error: `Faltam valores: ${emFalta.map(([, r]) => r).join(", ")}.` },
      { status: 400 }
    );
  }

  const linhasPrsi = Array.isArray(body?.prsi)
    ? body.prsi.filter((p: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(p?.effective_from || "")))
    : [];
  if (!linhasPrsi.length) {
    // Sem nenhuma linha de PRSI a folha cairia na tabela de fabrica sem ninguem
    // perceber porque. Recusa-se em vez de deixar o buraco.
    return NextResponse.json(
      { error: "Tem de existir pelo menos uma linha de PRSI, com a data em que passa a valer." },
      { status: 400 }
    );
  }

  const { error: e1 } = await sb.from("hr_tax_year").upsert({
    year: ano,
    ...cab,
    /*
     * CONFIRMAR é um acto, e fica assinado.
     *
     * A caixa "conferida contra a Revenue" grava QUEM e QUANDO. Sem isso a
     * marca não vale nada: seis meses depois ninguém sabe se foi conferida ou
     * se alguém carregou por engano — e é justamente aí que ela é invocada
     * para justificar um número.
     */
    confirmed_at: body?.confirmar ? new Date().toISOString() : null,
    confirmed_by: body?.confirmar ? user?.id ?? null : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "year" });
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

  /*
   * As bandas e as linhas de PRSI são REESCRITAS por inteiro.
   *
   * Editar linha a linha obrigaria a acertar quem foi apagado, quem é novo e
   * quem mudou — e uma banda esquecida no meio deixa um buraco na progressão
   * que ninguém vê até alguém ganhar exactamente aquele valor. Apagar e
   * regravar as poucas linhas que são é mais barato e não tem esse estado.
   */
  if (Array.isArray(body?.bandas)) {
    await sb.from("hr_usc_band").delete().eq("year", ano);
    const linhas = body.bandas
      .filter((b: any) => Number.isFinite(Number(b.rate_bps)))
      .map((b: any, i: number) => ({
        year: ano, reduced: !!b.reduced, ord: Number(b.ord) || i + 1,
        upto_cents: b.upto_cents === null || b.upto_cents === "" ? null : Number(b.upto_cents),
        rate_bps: Number(b.rate_bps),
      }));
    if (linhas.length) {
      const { error } = await sb.from("hr_usc_band").insert(linhas);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  {
    await sb.from("hr_prsi_rate").delete().eq("year", ano);
    const linhas = linhasPrsi
      .map((p: any) => ({
        year: ano, effective_from: p.effective_from,
        employee_bps: Number(p.employee_bps),
        employee_exempt_weekly_cents: Number(p.employee_exempt_weekly_cents),
        credit_max_cents: Number(p.credit_max_cents),
        credit_upto_weekly_cents: Number(p.credit_upto_weekly_cents),
        employer_lower_bps: Number(p.employer_lower_bps),
        employer_higher_bps: Number(p.employer_higher_bps),
        employer_threshold_weekly_cents: Number(p.employer_threshold_weekly_cents),
      }));
    const { error } = await sb.from("hr_prsi_rate").insert(linhas);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  /*
   * A ESCADA DA AE, gravada por DATA e nunca apagada em bloco.
   *
   * As bandas de USC e as linhas de PRSI reescrevem-se por inteiro porque são
   * do ano que se está a editar. A AE não é: ao apagá-la para regravar,
   * qualquer erro no meio deixava a folha sem auto-enrolment nenhum — e uma
   * contribuição que desaparece em silêncio é dinheiro que a pessoa devia ter
   * descontado e não descontou.
   *
   * Por isso vai por `upsert` degrau a degrau, e remover um é um acto próprio.
   */
  let mexeuNaAe = false;
  if (Array.isArray(body?.ae)) {
    mexeuNaAe = true;
    const degraus = body.ae
      .filter((a: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(a?.effective_from || "")))
      .map((a: any) => ({
        effective_from: a.effective_from,
        employee_bps: Number(a.employee_bps) || 0,
        employer_bps: Number(a.employer_bps) || 0,
        state_bps: Number(a.state_bps) || 0,
        min_annual_earnings_cents: Number(a.min_annual_earnings_cents) || 0,
        earnings_cap_cents: Number(a.earnings_cap_cents) || 0,
        min_age: Number(a.min_age) || 0,
        max_age: Number(a.max_age) || 0,
        source: String(a.source ?? ""),
        confirmed_at: a.confirmar ? new Date().toISOString() : (a.confirmed_at ?? null),
      }));
    if (degraus.length) {
      const { error } = await sb.from("hr_ae_rate")
        .upsert(degraus, { onConflict: "effective_from" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const d of (Array.isArray(body?.aeRemovidos) ? body.aeRemovidos : [])) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(d))) {
        await sb.from("hr_ae_rate").delete().eq("effective_from", d);
      }
    }
  }

  /*
   * A cache de 30s tem de morrer AQUI, senão recalcular logo a seguir a gravar
   * devolve o número velho e a edição parece não ter funcionado.
   *
   * Mexer na AE deita fora a cache de TODOS os anos, e não só a deste: um
   * degrau que começa em 2029 vale de 2029 em diante, portanto entra na tabela
   * de qualquer ano posterior — limpar só o ano editado deixava os outros a
   * calcular com o degrau antigo até a cache expirar sozinha.
   */
  esquecerTabela(mexeuNaAe ? undefined : ano);
  return NextResponse.json({ ok: true });
}
