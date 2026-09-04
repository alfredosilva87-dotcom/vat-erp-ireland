import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { integracoesDo } from "@/lib/integrations";
import { grossFor, isoWeekDay, type Employee, type WeekHours } from "@/lib/hr/payroll";
import type { ConfigDaEmpresa } from "@/lib/hr/regrasDaEmpresa";
import { CONTAS_PADRAO } from "@/lib/accounting/post";

/**
 * A folha de pagamento vira conta a pagar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A FOLHA PRECISA DE TÍTULO
 *
 * Sem isto a folha vivia num mundo só dela: o quadro semanal dizia que o
 * payslip estava feito, e o dinheiro saía do banco sem nada a ligar as duas
 * coisas. Na conciliação aparecia uma transferência grande, todo mês, que
 * ninguém conseguia casar com documento nenhum — e por isso ficava para trás,
 * mês após mês, a engordar a lista do que não bate.
 *
 * Com o título, o pagamento da folha passa a ter contra o quê casar, como
 * qualquer nota de fornecedor.
 * ---------------------------------------------------------------------------
 *
 * O período é o par (ano, semana, tipo). A identidade do título é o `id` da
 * linha em `hr_weeks`, o que dá idempotência de graça: marcar o payslip duas
 * vezes não cria duas dívidas.
 *
 * O valor é o BRUTO do período — o que a empresa desembolsa em salários. Os
 * descontos do trabalhador (PAYE/PRSI/USC) saem do bruto e são devidos à
 * Revenue, não ao trabalhador; separá-los em dois títulos é o passo seguinte,
 * e não se faz por adivinhação: depende de como o escritório paga a Revenue.
 */

const sb = () => getServerSupabase();

const NOME_TIPO: Record<string, string> = {
  weekly: "semanal", fortnightly: "quinzenal", monthly: "mensal",
};

/** O bruto do período, somando os funcionários daquele tipo de folha. */
async function brutoDoPeriodo(
  clientId: string, year: number, week: number, freq: string
): Promise<{ total: number; pessoas: number }> {
  const { data: funcionarios } = await sb().from("hr_employees")
    .select("id,pay_type,hourly_rate,sunday_rate,fixed_amount,freq_type,contract_type,active")
    .eq("client_id", clientId).eq("freq_type", freq).eq("active", true);

  const lista = (funcionarios ?? []) as any[];
  if (lista.length === 0) return { total: 0, pessoas: 0 };

  const { data: horas } = await sb().from("hr_employee_hours")
    .select("employee_id,hours,sunday_hours,gross_override,holiday_hours,week_worked")
    .in("employee_id", lista.map((f) => f.id))
    .eq("year", year).eq("week_no", week);

  const porFuncionario = new Map<string, any>(((horas ?? []) as any[]).map((h) => [h.employee_id, h]));

  /*
   * As REGRAS DA EMPRESA entram também aqui.
   *
   * Este total vira o título a pagar da folha, na contabilidade. Calculá-lo sem
   * o prémio de domingo punha o razão a discordar do recibo — e a diferença
   * apareceria como um desencontro no banco, meses depois, sem causa aparente.
   */
  const { data: regrasDaEmpresa } = await sb().from("hr_client")
    .select("sunday_mode,sunday_multiplier,overtime_after_hours,overtime_multiplier,"
      + "holiday_accrual_pct,holiday_days_year")
    .eq("client_id", clientId).maybeSingle();
  const cfgEmpresa = (regrasDaEmpresa ?? null) as ConfigDaEmpresa | null;

  let total = 0;
  for (const f of lista) {
    // `grossFor` é o MESMO cálculo do quadro semanal — importado, não
    // reescrito. Duas contas do mesmo salário divergem no dia em que uma
    // delas for corrigida.
    total += grossFor(f as Employee, (porFuncionario.get(f.id) ?? null) as WeekHours | null, cfgEmpresa);
  }
  return { total: Math.round(total * 100) / 100, pessoas: lista.length };
}

export type ResultadoFolha = { id: string | null; jaExistia: boolean; ignorado?: string; total?: number };

export async function garantirTituloDeFolha(
  clientId: string, year: number, week: number, freq: string
): Promise<ResultadoFolha> {
  const { data: semana } = await sb().from("hr_weeks")
    .select("id").eq("client_id", clientId).eq("year", year)
    .eq("week_no", week).eq("freq_type", freq).maybeSingle();
  const weekId = (semana as any)?.id;
  if (!weekId) return { id: null, jaExistia: false, ignorado: "Semana nao encontrada." };

  const { data: ja } = await sb().from("ledger_items")
    .select("id").eq("client_id", clientId).eq("document_id", weekId).maybeSingle();
  if (ja) return { id: (ja as any).id, jaExistia: true };

  const integra = await integracoesDo(clientId);
  if (!integra.hr_to_payable) {
    return { id: null, jaExistia: false, ignorado: "Integracao RH->pagar desligada." };
  }

  const { total, pessoas } = await brutoDoPeriodo(clientId, year, week, freq);
  // Semana sem gente ou sem horas não é dívida. Um título de €0,00 na lista é
  // ruído que ninguém sabe fechar.
  if (total <= 0) return { id: null, jaExistia: false, ignorado: "Periodo sem valor.", total };

  /*
   * Vence na sexta-feira da semana ISO.
   *
   * É quando a folha é paga na prática irlandesa, e um vencimento plausível é
   * o que faz o título aparecer no sítio certo da lista de vencidos. `5` é
   * sexta em `isoWeekDay`, que conta a semana a começar na segunda.
   */
  const vencimento = isoWeekDay(year, week, 5).toISOString().slice(0, 10);

  const { data, error } = await sb().from("ledger_items").insert({
    client_id: clientId, kind: "payable", source_module: "payroll",
    document_id: weekId,
    document_ref: `FOLHA ${year}-S${String(week).padStart(2, "0")}`,
    counterparty: `Folha de pagamento (${NOME_TIPO[freq] ?? freq})`,
    issue_date: vencimento, due_date: vencimento,
    // A conta vem do motor, e não cravada: ver CONTAS_PADRAO em
    // lib/accounting/post.ts, que mudou com o plano da prática.
    original_amount: total, account_code: CONTAS_PADRAO.payrollLiability,
    notes: `${pessoas} funcionario(s), folha ${NOME_TIPO[freq] ?? freq}`,
  }).select("id").single();
  if (error) return { id: null, jaExistia: false, ignorado: error.message };
  return { id: (data as any).id, jaExistia: false, total };
}

/**
 * Desfaz o título quando alguém desmarca o payslip.
 *
 * Só remove se NÃO houver baixa: um título já pago não desaparece porque
 * alguém corrigiu uma marca no quadro — o dinheiro saiu do banco, e apagar a
 * dívida deixaria a baixa órfã e o banco sem contrapartida.
 */
export async function removerTituloDeFolha(
  clientId: string, year: number, week: number, freq: string
): Promise<{ removido: boolean; motivo?: string }> {
  const { data: semana } = await sb().from("hr_weeks")
    .select("id").eq("client_id", clientId).eq("year", year)
    .eq("week_no", week).eq("freq_type", freq).maybeSingle();
  const weekId = (semana as any)?.id;
  if (!weekId) return { removido: false, motivo: "Semana nao encontrada." };

  const { data: titulo } = await sb().from("ledger_items")
    .select("id").eq("client_id", clientId).eq("document_id", weekId).maybeSingle();
  if (!titulo) return { removido: false, motivo: "Sem titulo." };

  const { count } = await sb().from("ledger_settlements")
    .select("id", { count: "exact", head: true }).eq("ledger_item_id", (titulo as any).id);
  if ((count ?? 0) > 0) return { removido: false, motivo: "Titulo ja tem baixa." };

  await sb().from("ledger_items").delete().eq("id", (titulo as any).id);
  return { removido: true };
}
