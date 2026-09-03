import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { correrFolha, semanasDoPeriodo } from "@/lib/hr/folha";
import { grossFor, type Employee, type WeekHours } from "@/lib/hr/payroll";
import {
  cents, linhasDePagamento, type FreqType, type Payslip,
} from "@/lib/hr/payslipPuro";
import { semanasSeguraveis } from "@/lib/hr/psrPuro";

/**
 * MONTAR os recibos de um período, para imprimir.
 *
 * ---------------------------------------------------------------------------
 * O RECIBO FECHADO LÊ-SE DO QUE FOI GRAVADO, E NÃO SE RECALCULA
 *
 * Esta é a decisão inteira deste ficheiro. Um payslip `final` é um FACTO: foi
 * este o imposto retido, com esta tabela, nesta data (ver a migração 050).
 * Reimprimir a semana 12 em Dezembro tem de dar o mesmo papel que saiu em
 * Março — e daria outro se se recalculasse, porque entretanto a tabela fiscal
 * pode ter sido corrigida no cadastro.
 *
 * O pior desta falha é ser silenciosa: os dois papéis parecem bons, e só quem
 * tiver os dois à frente é que vê que discordam.
 *
 * ---------------------------------------------------------------------------
 * E O QUE AINDA NÃO FOI FECHADO SAI COMO RASCUNHO
 *
 * Recusar imprimir antes de fechar obrigava a fechar às cegas: ninguém pode
 * conferir um recibo que não consegue ver. Então calcula-se em memória e o
 * papel sai com a tarja DRAFT atravessada — que é o que impede um rascunho de
 * ser entregue por engano.
 */

export type { Payslip } from "@/lib/hr/payslipPuro";

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export async function payslipsDoPeriodo(args: {
  clientId: string;
  year: number;
  periodNo: number;
  freqType: FreqType;
  /** Um só, ou todos os do bloco quando vem vazio. */
  employeeId?: string | null;
}): Promise<Payslip[]> {
  const sb = getServerSupabase();
  const { clientId, year, periodNo, freqType } = args;
  const semanas = semanasDoPeriodo(freqType, year, periodNo);

  const [{ data: cli }, { data: cfg }, { data: emps }, { data: gravados }] = await Promise.all([
    sb.from("clients")
      .select("name,trading_name,address,phone,email,employer_number,vat_number,cro")
      .eq("id", clientId).maybeSingle(),
    sb.from("hr_client").select("payslip_show_hours").eq("client_id", clientId).maybeSingle(),
    sb.from("hr_employees").select("*")
      .eq("client_id", clientId).eq("freq_type", freqType).order("first_name"),
    sb.from("hr_payslip").select("*")
      .eq("client_id", clientId).eq("year", year).eq("freq_type", freqType),
  ]);
  if (!cli) return [];

  const funcionarios = ((emps ?? []) as any[])
    .filter((e) => !args.employeeId || e.id === args.employeeId);
  if (!funcionarios.length) return [];

  const payslips = ((gravados ?? []) as any[]);
  const ids = funcionarios.map((e) => e.id);
  const { data: horas } = await sb.from("hr_employee_hours").select("*")
    .eq("year", year).in("employee_id", ids);

  const porFuncionario = new Map<string, any[]>();
  for (const h of ((horas ?? []) as any[])) {
    if (!semanas.includes(Number(h.week_no))) continue;
    const a = porFuncionario.get(h.employee_id) ?? [];
    a.push(h); porFuncionario.set(h.employee_id, a);
  }

  /*
   * A folha viva só se corre quando ALGUÉM não tem recibo gravado.
   *
   * `correrFolha` lê o quadro inteiro e a tabela fiscal; chamá-la para imprimir
   * doze recibos já fechados seria trabalho puro sem efeito nenhum no papel.
   */
  const faltamGravados = funcionarios.some(
    (e) => !payslips.find((p) => p.employee_id === e.id && Number(p.period_no) === periodNo)
  );
  const viva = faltamGravados
    ? await correrFolha({ clientId, year, periodNo, freqType })
    : null;

  const empregador = {
    nome: (cli as any).trading_name?.trim() || (cli as any).name,
    linhas: [
      ...String((cli as any).address ?? "").split("\n").map((s: string) => s.trim()).filter(Boolean),
      ...((cli as any).phone ? [String((cli as any).phone)] : []),
      ...((cli as any).email ? [String((cli as any).email)] : []),
    ],
    numeroDeEmpregador: (cli as any).employer_number?.trim() || null,
    registoComercial: (cli as any).cro?.trim() || null,
  };

  return funcionarios.map((e): Payslip => {
    const gravado = payslips.find(
      (p) => p.employee_id === e.id && Number(p.period_no) === periodNo
    );
    const linhaViva = viva?.linhas.find((l) => l.employeeId === e.id) ?? null;
    const rascunho = !gravado || gravado.status !== "final";

    const doPeriodo = (porFuncionario.get(e.id) ?? []) as (WeekHours & { week_no: number })[];

    /*
     * O BRUTO vem do recibo gravado quando ele existe.
     *
     * Recalcular pelas horas dava outro número sempre que alguém corrigiu o
     * livro de horas DEPOIS de fechar a folha — e aí o recibo reimpresso
     * mostrava um bruto que nunca foi pago.
     */
    const brutoCents = gravado
      ? n(gravado.gross_cents)
      : linhaViva?.brutoCents
        ?? doPeriodo.reduce((s, h) => s + cents(grossFor(e as Employee, h)), 0);

    /*
     * O ACUMULADO DE AE não tem coluna própria em `hr_payslip`.
     *
     * As outras quatro têm (`cum_*`), porque a base cumulativa precisa delas
     * para calcular. A AE não entra em cálculo nenhum — sai do líquido — e por
     * isso soma-se aqui, dos recibos fechados do ano até este.
     *
     * O acumulado de abertura da migração (`ytd_opening_*`) também não tem AE:
     * quem migra a meio do ano traz o imposto, e a AE do sistema anterior fica
     * de fora. Está certo assim para o cálculo e é uma lacuna no PAPEL — o
     * acumulado de AE de quem migrou conta a partir da migração.
     */
    const aeAteAqui = payslips
      .filter((p) => p.employee_id === e.id && p.status === "final"
        && Number(p.period_no) <= periodNo)
      .reduce((s, p) => s + n(p.ae_ee_cents), 0);

    const mostrarHoras = (cfg as any)?.payslip_show_hours !== false;

    const descontos = gravado
      ? {
        payeCents: n(gravado.paye_cents), uscCents: n(gravado.usc_cents),
        prsiCents: n(gravado.prsi_ee_cents), aeCents: n(gravado.ae_ee_cents),
      }
      : {
        payeCents: linhaViva?.payeCents ?? 0, uscCents: linhaViva?.uscCents ?? 0,
        prsiCents: linhaViva?.prsiEeCents ?? 0, aeCents: linhaViva?.aeEeCents ?? 0,
      };
    const prsiEr = gravado ? n(gravado.prsi_er_cents) : (linhaViva?.prsiErCents ?? 0);
    const aeEr = gravado ? n(gravado.ae_er_cents) : (linhaViva?.aeErCents ?? 0);

    return {
      empregador,
      pessoa: {
        nome: [e.first_name, e.surname].filter(Boolean).join(" "),
        codigo: e.code ?? null,
        cargo: e.job_title ?? null,
        /*
         * O PPS VAI NO RECIBO, e isso não contradiz a migração 049.
         *
         * A regra de lá — "só sai na submissão à Revenue" — protege o dado de
         * aparecer em relatórios e exportações do escritório. Este papel é da
         * própria pessoa, sobre a própria pessoa, e todo o payslip irlandês o
         * traz: é por ele que ela confere que o imposto foi para a conta certa.
         */
        pps: e.pps_number ?? null,
        dataDeAdmissao: e.start_date ?? null,
      },
      periodo: {
        ano: year, numero: periodNo, freq: freqType, semanas,
        letra: freqType === "monthly" ? "M" : freqType === "fortnightly" ? "F" : "W",
        dataPagamento: gravado ? String(gravado.pay_date).slice(0, 10)
          : (viva?.payDate ?? `${year}-01-01`),
      },
      pagamentos: linhasDePagamento(e as Employee & { pay_type: string }, doPeriodo, brutoCents, mostrarHoras),
      brutoCents,
      /*
       * TRIBUTÁVEL = BRUTO enquanto não houver pensão com desgravação.
       *
       * A AE não abate — sai do líquido. Ver a migração 053: é o ponto que
       * mais se erra, e o payslip dele prova a regra com os dois números
       * iguais.
       */
      tributavelCents: brutoCents,
      descontos,
      liquidoCents: gravado ? n(gravado.net_cents) : (linhaViva?.liquidoCents ?? 0),
      acumulado: {
        brutoCents: gravado ? n(gravado.cum_gross_cents) : (linhaViva?.acumulado.bruto ?? 0),
        payeCents: gravado ? n(gravado.cum_paye_cents) : (linhaViva?.acumulado.paye ?? 0),
        uscCents: gravado ? n(gravado.cum_usc_cents) : (linhaViva?.acumulado.usc ?? 0),
        prsiCents: gravado ? n(gravado.cum_prsi_cents) : (linhaViva?.acumulado.prsi ?? 0),
        aeCents: aeAteAqui + (gravado?.status === "final" ? 0 : descontos.aeCents),
        /*
         * O PRSI DO EMPREGADOR acumulado — `EMPER PRSI TD` no recibo do Sage.
         *
         * Como a AE, não tem coluna `cum_*` própria: a base cumulativa não
         * precisa dele para calcular nada. Soma-se dos recibos fechados do ano.
         */
        prsiEmpregadorCents: payslips
          .filter((p) => p.employee_id === e.id && p.status === "final"
            && Number(p.period_no) <= periodNo)
          .reduce((sm, p) => sm + n(p.prsi_er_cents), 0)
          + (gravado?.status === "final" ? 0 : prsiEr),
      },
      patrao: {
        prsiCents: prsiEr, aeCents: aeEr,
        custoCents: gravado ? brutoCents + prsiEr + aeEr : (linhaViva?.custoEmpregadorCents ?? 0),
      },
      fiscal: (() => {
        const cutOff = gravado ? n(gravado.cutoff_used_cents) : (linhaViva?.aplicado.cutOff ?? 0);
        const creditos = gravado ? n(gravado.credits_used_cents) : (linhaViva?.aplicado.creditos ?? 0);
        /*
         * O valor DO PERÍODO deduz-se do acumulado, e é exacto.
         *
         * O motor calcula o acumulado como `valorDoPeriodo × númeroDoPeriodo`
         * (arredondado para cima uma vez, por período — ver `ateAqui`). Dividir
         * de volta devolve o mesmo cêntimo, sem ter de guardar um segundo
         * número que podia divergir do primeiro.
         */
        const porPeriodo = (total: number) => (periodNo > 0 ? Math.round(total / periodNo) : total);
        return {
          base: gravado ? String(gravado.basis) : (linhaViva?.aplicado.base ?? "cumulativa"),
          cutOffCents: cutOff,
          creditosCents: creditos,
          cutOffPeriodoCents: porPeriodo(cutOff),
          creditosPeriodoCents: porPeriodo(creditos),
          classePRSI: e.prsi_class ?? null,
          estadoFiscal: (() => {
            const b = gravado ? String(gravado.basis) : (linhaViva?.aplicado.base ?? "cumulativa");
            return b === "emergencia" ? "E" : b === "semana1" ? "W1" : "N";
          })(),
          semanasSeguraveis: semanasSeguraveis({
            freq: freqType,
            semanasDoPeriodo: semanas,
            semanasComTrabalho: doPeriodo
              .filter((h) => Number(h.hours) > 0 || Number(h.sunday_hours) > 0
                || Number(h.holiday_hours) > 0 || h.week_worked)
              .map((h) => Number((h as any).week_no)),
            brutoCents,
          }),
          anoDaTabela: gravado ? (gravado.tax_year_used ?? null) : year,
          tabelaConferida: gravado ? !!gravado.table_confirmed : false,
        };
      })(),
      mostrarHoras,
      rascunho,
      /*
       * Os avisos do recibo GRAVADO são os que valiam quando ele fechou.
       *
       * Guardá-los em `warnings` foi a razão de a coluna existir: seis meses
       * depois é isto que responde a "porque é que esta semana reteve tanto?".
       */
      avisos: gravado ? (gravado.warnings ?? []) : (linhaViva?.avisos ?? []),
    };
  });
}
