import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { integracoesDo } from "@/lib/integrations";
import { grossFor, isoWeekDay, type Employee, type WeekHours } from "@/lib/hr/payroll";
import type { ConfigDaEmpresa } from "@/lib/hr/regrasDaEmpresa";
import { CONTAS_PADRAO } from "@/lib/accounting/post";
import { semanasDoPeriodo } from "@/lib/hr/folha";
import {
  chaveDoTituloDaFolha, partirAFolha, periodoDaSemana, referenciaDoTituloDaFolha,
  vencimentoDoImpostoDaFolha,
  type FreqDaFolha, type TipoDeTituloDaFolha, type TotaisDaFolha,
} from "@/lib/hr/titulosDaFolhaPuro";

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

  /*
   * GUARDA CONTRA DUPLICADO entre os dois caminhos.
   *
   * Há dois sítios que criam título de folha: este (marcar o payslip no quadro
   * semanal antigo, que está em produção e a conciliar) e `garantirTitulosDaFolha`,
   * que nasce ao fechar a folha no ecrã moderno. O primeiro raciocina por
   * SEMANA e escreve um título pelo bruto; o segundo raciocina por PERÍODO e
   * escreve dois, líquido e imposto.
   *
   * Nada impede a mesma empresa de usar os dois. Sem esta guarda, a semana 36
   * marcada no quadro depois de a folha de Setembro estar fechada punha o mesmo
   * salário a pagar duas vezes na lista — e ninguém repara, porque os valores
   * são diferentes (um é bruto, o outro é líquido) e parecem coisas distintas.
   *
   * Quem já lá está ganha: não se apaga o que existe, recusa-se o que ia
   * duplicar, e diz-se qual é o título que mandou parar.
   */
  const jaPeloPeriodo = await tituloModernoQueCobre(clientId, year, week, freq);
  if (jaPeloPeriodo) {
    return {
      id: null, jaExistia: false,
      ignorado: `A folha deste periodo ja tem titulo (${jaPeloPeriodo}).`,
    };
  }

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

// =========================================================================
// O PAR DE TÍTULOS: líquido e imposto
// =========================================================================

/**
 * Por que a folha moderna não reaproveita `garantirTituloDeFolha`.
 *
 * Aquela função é do quadro semanal: recalcula o bruto a partir das horas, e é
 * pelo bruto que grava. Aqui os números já vêm CALCULADOS de `correrFolha` —
 * com imposto, acumulado, cut-off e créditos — e recalcular seria arriscar que
 * o título dissesse um valor e o recibo dissesse outro.
 *
 * Ver `lib/hr/titulosDaFolhaPuro.ts` para o porquê de serem dois, de onde vem a
 * chave de idempotência e de onde vem o dia 14.
 */

/**
 * O que impediu um título de nascer, em CHAVE de tradução e não em prosa.
 *
 * O caminho antigo devolve frases em português, e elas acabavam a aparecer
 * num ecrã inglês. Aqui devolve-se o código e os parâmetros — o mesmo padrão
 * dos avisos da folha (`Aviso` em `lib/hr/fiscal/motor.ts`) — e quem mostra
 * traduz. A geração em lote precisa disto na mesma, porque o relatório dela
 * também é lido por gente que não fala português.
 */
export type RecadoDoTitulo = { codigo: string; params?: Record<string, string | number> };

export type TituloDaFolha = {
  tipo: TipoDeTituloDaFolha;
  id: string | null;
  jaExistia: boolean;
  valorCents: number;
  ignorado?: RecadoDoTitulo;
};

/**
 * O beneficiário, como aparece na lista de contas a pagar.
 *
 * Em inglês porque é o idioma por omissão dos ecrãs — e porque estes dois nomes
 * são quem RECEBE uma transferência real, que ninguém traduz no homebanking.
 * `Revenue` é o nome da autoridade fiscal irlandesa.
 */
const BENEFICIARIO: Record<TipoDeTituloDaFolha, string> = {
  liquido: "Employees (net pay)",
  imposto: "Revenue (PAYE/USC/PRSI)",
};

/** Já existe título do caminho ANTIGO para alguma semana deste período? */
async function tituloAntigoDoPeriodo(
  clientId: string, year: number, periodNo: number, freqType: FreqDaFolha
): Promise<string | null> {
  const semanas = semanasDoPeriodo(freqType, year, periodNo);
  if (!semanas.length) return null;

  const { data: linhas } = await sb().from("hr_weeks")
    .select("id").eq("client_id", clientId).eq("year", year)
    .eq("freq_type", freqType).in("week_no", semanas);
  const ids = ((linhas ?? []) as any[]).map((l) => l.id);
  if (!ids.length) return null;

  const { data: titulo } = await sb().from("ledger_items")
    .select("document_ref").eq("client_id", clientId)
    .eq("source_module", "payroll").in("document_id", ids).limit(1);
  const um = ((titulo ?? []) as any[])[0];
  return um ? (um.document_ref || "sem referencia") : null;
}

/** E o contrário: já existe o par moderno que cobre esta semana? */
async function tituloModernoQueCobre(
  clientId: string, year: number, week: number, freq: string
): Promise<string | null> {
  if (freq !== "weekly" && freq !== "fortnightly" && freq !== "monthly") return null;
  const periodo = periodoDaSemana(freq, year, week);
  const chaves = (["liquido", "imposto"] as TipoDeTituloDaFolha[])
    .map((t) => chaveDoTituloDaFolha(clientId, year, periodo, freq, t));

  const { data } = await sb().from("ledger_items")
    .select("document_ref").eq("client_id", clientId).in("document_id", chaves).limit(1);
  const um = ((data ?? []) as any[])[0];
  return um ? (um.document_ref || "sem referencia") : null;
}

export async function garantirTitulosDaFolha(args: {
  clientId: string; year: number; periodNo: number; freqType: FreqDaFolha;
  payDate: string; totais: TotaisDaFolha; pessoas: number;
}): Promise<{ titulos: TituloDaFolha[]; ignorado?: RecadoDoTitulo }> {
  const { clientId, year, periodNo, freqType, payDate } = args;

  const integra = await integracoesDo(clientId);
  if (!integra.hr_to_payable) {
    return { titulos: [], ignorado: { codigo: "titulo.integracaoDesligada" } };
  }

  const antigo = await tituloAntigoDoPeriodo(clientId, year, periodNo, freqType);
  if (antigo) {
    return { titulos: [], ignorado: { codigo: "titulo.jaPeloQuadro", params: { ref: antigo } } };
  }

  const { liquidoCents, impostoCents } = partirAFolha(args.totais);

  const plano: {
    tipo: TipoDeTituloDaFolha; cents: number; vencimento: string; conta: string;
  }[] = [
    { tipo: "liquido", cents: liquidoCents, vencimento: payDate,
      conta: CONTAS_PADRAO.payrollLiability },
    { tipo: "imposto", cents: impostoCents, vencimento: vencimentoDoImpostoDaFolha(payDate),
      conta: CONTAS_PADRAO.payeLiability },
  ];

  const titulos: TituloDaFolha[] = [];
  for (const p of plano) {
    const chave = chaveDoTituloDaFolha(clientId, year, periodNo, freqType, p.tipo);
    const referencia = referenciaDoTituloDaFolha(year, periodNo, freqType, p.tipo);

    const { data: ja } = await sb().from("ledger_items")
      .select("id").eq("client_id", clientId).eq("document_id", chave).maybeSingle();
    if (ja) {
      titulos.push({ tipo: p.tipo, id: (ja as any).id, jaExistia: true, valorCents: p.cents });
      continue;
    }

    /*
     * Zero ou negativo não vira título.
     *
     * `ledger_items` recusa `original_amount <= 0`, e faz bem. Acontece de
     * verdade no imposto: uma folha em que o cumulativo devolve mais PAYE do
     * que a soma de USC e PRSI dá um saldo A FAVOR do empregador, que a Revenue
     * abate no mês seguinte — não é dívida a pagar, é crédito. Dizer aqui que
     * não se criou, e porquê, vale mais do que uma linha de €0,00 que ninguém
     * sabe fechar.
     */
    if (p.cents <= 0) {
      titulos.push({
        tipo: p.tipo, id: null, jaExistia: false, valorCents: p.cents,
        ignorado: { codigo: p.cents === 0 ? "titulo.semValor" : "titulo.saldoAFavor" },
      });
      continue;
    }

    const { data, error } = await sb().from("ledger_items").insert({
      client_id: clientId, kind: "payable", source_module: "payroll",
      document_id: chave, document_ref: referencia,
      counterparty: BENEFICIARIO[p.tipo],
      issue_date: payDate, due_date: p.vencimento,
      original_amount: Math.round(p.cents) / 100,
      account_code: p.conta,
      // O que um pagamento vai precisar de saber, para o dia em que houver
      // ligação ao banco. Ver a migração 062.
      payment_reference: referencia,
      notes: p.tipo === "liquido"
        ? `${args.pessoas} funcionario(s), liquido da folha`
        : `PAYE+USC+PRSI (empregado e empregador) de ${args.pessoas} funcionario(s)`,
    }).select("id").single();

    if (error) {
      /*
       * `23505` é o índice único de `(client_id, document_id)` — migração 041.
       *
       * Chegar aqui significa que outro pedido criou o mesmo título entre o
       * SELECT acima e este INSERT. Não é erro: é a idempotência a funcionar no
       * único sítio onde ela tem mesmo de funcionar, que é a corrida entre dois
       * cliques no botão de fechar.
       */
      const corrida = (error as any).code === "23505";
      titulos.push({
        tipo: p.tipo, id: null, jaExistia: corrida, valorCents: p.cents,
        ignorado: corrida ? undefined : { codigo: "titulo.erro", params: { erro: error.message } },
      });
      continue;
    }
    titulos.push({ tipo: p.tipo, id: (data as any).id, jaExistia: false, valorCents: p.cents });
  }

  return { titulos };
}

/**
 * Reabrir desfaz os títulos — mas só os que ainda não têm baixa.
 *
 * Mesma regra de `removerTituloDeFolha`: se o dinheiro já saiu do banco, a
 * dívida não desaparece porque alguém reabriu o período. Apagá-la deixava a
 * baixa órfã e o extrato sem contrapartida.
 *
 * Reabrir com um dos dois já pago é possível e não é erro: costuma ser o
 * líquido pago e o imposto ainda por pagar, e é exactamente aí que se descobre
 * um engano na folha. Remove-se o que dá, mantém-se o que não dá, e devolve-se
 * a lista para quem reabriu saber o que ficou para trás.
 */
export async function removerTitulosDaFolha(args: {
  clientId: string; year: number; periodNo: number; freqType: FreqDaFolha;
}): Promise<{ removidos: number; mantidos: { tipo: TipoDeTituloDaFolha; motivo: RecadoDoTitulo }[] }> {
  const { clientId, year, periodNo, freqType } = args;
  let removidos = 0;
  const mantidos: { tipo: TipoDeTituloDaFolha; motivo: RecadoDoTitulo }[] = [];

  for (const tipo of ["liquido", "imposto"] as TipoDeTituloDaFolha[]) {
    const chave = chaveDoTituloDaFolha(clientId, year, periodNo, freqType, tipo);
    const { data: titulo } = await sb().from("ledger_items")
      .select("id").eq("client_id", clientId).eq("document_id", chave).maybeSingle();
    if (!titulo) continue;

    const { count } = await sb().from("ledger_settlements")
      .select("id", { count: "exact", head: true }).eq("ledger_item_id", (titulo as any).id);
    if ((count ?? 0) > 0) { mantidos.push({ tipo, motivo: { codigo: "titulo.temBaixa" } }); continue; }

    const { error } = await sb().from("ledger_items").delete().eq("id", (titulo as any).id);
    if (error) {
      mantidos.push({ tipo, motivo: { codigo: "titulo.erro", params: { erro: error.message } } });
      continue;
    }
    removidos++;
  }
  return { removidos, mantidos };
}
