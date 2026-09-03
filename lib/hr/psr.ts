import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { semanasDoPeriodo } from "@/lib/hr/folha";
import {
  criticarLinha, diasDeAtraso, semanasSeguraveis, totaisDaSubmissao,
  type Freq, type LinhaPSR, type Reparo,
} from "@/lib/hr/psrPuro";

/**
 * MONTAR a submissão de folha de um período.
 *
 * ---------------------------------------------------------------------------
 * SÓ ENTRA O QUE ESTÁ FECHADO
 *
 * A submissão parte dos payslips `final`, e nunca de um cálculo em memória.
 * Comunicar um rascunho à Revenue é comunicar um número que ainda vai mudar —
 * e a correcção seguinte já não é um retoque no ecrã, é uma submissão
 * correctiva com explicação.
 *
 * Um período sem payslips fechados devolve zero linhas, e o ecrã diz que
 * primeiro se fecha a folha.
 */

export type Submissao = {
  clientId: string;
  year: number;
  periodNo: number;
  freqType: Freq;
  payDate: string;
  employerNumber: string | null;
  linhas: (LinhaPSR & { reparos: Reparo[] })[];
  totais: ReturnType<typeof totaisDaSubmissao>;
  /** Quantos dias passaram da data de pagamento. Zero é o normal. */
  atrasoDias: number;
  /** O que impede o envio, somado. */
  bloqueios: number;
  /** Já registada? Então mostra-se o comprovativo em vez do rascunho. */
  registada: {
    id: string; status: string; rosReference: string | null; submittedAt: string | null;
  } | null;
  /** O que este sistema ainda não sabe comunicar. */
  lacunas: string[];
};

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export async function montarSubmissao(args: {
  clientId: string; year: number; periodNo: number; freqType: Freq;
}): Promise<Submissao> {
  const sb = getServerSupabase();
  const { clientId, year, periodNo, freqType } = args;
  const semanas = semanasDoPeriodo(freqType, year, periodNo);

  const [{ data: cli }, { data: fechados }, { data: registo }] = await Promise.all([
    sb.from("clients").select("employer_number").eq("id", clientId).maybeSingle(),
    sb.from("hr_payslip").select("*")
      .eq("client_id", clientId).eq("year", year)
      .eq("period_no", periodNo).eq("freq_type", freqType)
      .eq("status", "final"),
    sb.from("hr_psr").select("id,status,ros_reference,submitted_at")
      .eq("client_id", clientId).eq("year", year)
      .eq("period_no", periodNo).eq("freq_type", freqType).maybeSingle(),
  ]);

  const payslips = ((fechados ?? []) as any[]);
  const ids = payslips.map((p) => p.employee_id);

  const [{ data: emps }, { data: horas }] = await Promise.all([
    ids.length
      ? sb.from("hr_employees").select("*").in("id", ids)
      : Promise.resolve({ data: [] as any[] }),
    ids.length
      ? sb.from("hr_employee_hours").select("employee_id,week_no,hours,sunday_hours,holiday_hours,week_worked")
        .eq("year", year).in("employee_id", ids)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const porId = new Map(((emps ?? []) as any[]).map((e) => [e.id, e]));
  const comTrabalho = new Map<string, number[]>();
  for (const h of ((horas ?? []) as any[])) {
    if (!(n(h.hours) > 0 || n(h.sunday_hours) > 0 || n(h.holiday_hours) > 0 || h.week_worked)) continue;
    const a = comTrabalho.get(h.employee_id) ?? [];
    a.push(Number(h.week_no)); comTrabalho.set(h.employee_id, a);
  }

  const payDate = payslips.length
    ? String(payslips[0].pay_date).slice(0, 10)
    : `${year}-01-01`;

  const linhas = payslips.map((p) => {
    const e = porId.get(p.employee_id) ?? {};
    const base: LinhaPSR = {
      employeeId: p.employee_id,
      nome: [e.first_name, e.surname].filter(Boolean).join(" ") || "—",
      pps: e.pps_number ?? null,
      employmentId: e.employment_id ?? null,
      dataPagamento: String(p.pay_date).slice(0, 10),
      freq: freqType,
      brutoCents: n(p.gross_cents),
      /*
       * TRIBUTÁVEL = BRUTO, e isso é a regra e não uma simplificação.
       *
       * O que reduziria a base seria uma pensão com desgravação (PRSA, pensão
       * ocupacional). O auto-enrolment NÃO reduz — sai do líquido — e esse é o
       * ponto que mais se erra. Ver a migração 053.
       */
      tributavelCents: n(p.gross_cents),
      payeCents: n(p.paye_cents),
      uscCents: n(p.usc_cents),
      prsiEmpregadoCents: n(p.prsi_ee_cents),
      prsiEmpregadorCents: n(p.prsi_er_cents),
      classePRSI: e.prsi_class ?? null,
      semanasSeguraveis: semanasSeguraveis({
        freq: freqType,
        semanasDoPeriodo: semanas,
        semanasComTrabalho: comTrabalho.get(p.employee_id) ?? [],
        brutoCents: n(p.gross_cents),
      }),
      aeEmpregadoCents: n(p.ae_ee_cents),
      aeEmpregadorCents: n(p.ae_er_cents),
    };
    return { ...base, reparos: criticarLinha(base) };
  });

  return {
    clientId, year, periodNo, freqType, payDate,
    employerNumber: (cli as any)?.employer_number?.trim() || null,
    linhas,
    totais: totaisDaSubmissao(linhas),
    atrasoDias: diasDeAtraso(payDate, new Date().toISOString().slice(0, 10)),
    bloqueios: linhas.reduce((s, l) => s + l.reparos.filter((r) => r.bloqueia).length, 0),
    registada: registo
      ? {
        id: (registo as any).id, status: (registo as any).status,
        rosReference: (registo as any).ros_reference ?? null,
        submittedAt: (registo as any).submitted_at ?? null,
      }
      : null,
    /*
     * AS LACUNAS, ditas em voz alta.
     *
     * Uma submissão que se apresenta como completa e não é vale menos do que
     * nenhuma: quem confia nela deixa de conferir. Estes três campos existem no
     * PSR e este sistema ainda não os produz — enquanto for assim, dizem-se.
     */
    lacunas: ["psr.gapLpt", "psr.gapExclusion", "psr.gapShadow"],
  };
}

/**
 * REGISTAR que a submissão foi comunicada.
 *
 * Guarda os valores tal como foram no momento — ver a migração 054: o que se
 * disse à Revenue é um facto histórico, e reabrir um payslip depois não pode
 * reescrever essa história em silêncio.
 */
export async function registarSubmissao(args: {
  clientId: string; year: number; periodNo: number; freqType: Freq;
  rosReference: string; userId?: string | null; notes?: string | null;
}): Promise<{ ok: boolean; erro?: string; linhas?: number }> {
  const s = await montarSubmissao(args);

  if (!s.linhas.length) {
    return { ok: false, erro: "Nao ha payslips fechados neste periodo para comunicar." };
  }
  if (s.bloqueios) {
    return {
      ok: false,
      erro: `Ha ${s.bloqueios} problema(s) que impedem a submissao. `
        + "Corrija-os antes de registar — comunicar assim e comunicar errado.",
    };
  }
  if (s.registada?.status === "sent") {
    return { ok: false, erro: "Este periodo ja esta comunicado. Uma correccao e uma submissao nova." };
  }

  const sb = getServerSupabase();
  const agora = new Date().toISOString();

  const { data: cab, error } = await sb.from("hr_psr").upsert({
    client_id: args.clientId, year: args.year, period_no: args.periodNo,
    freq_type: args.freqType, pay_date: s.payDate,
    employer_number: s.employerNumber,
    gross_cents: s.totais.bruto, paye_cents: s.totais.paye, usc_cents: s.totais.usc,
    prsi_ee_cents: s.totais.prsiEe, prsi_er_cents: s.totais.prsiEr,
    insurable_weeks: s.totais.semanas,
    status: "sent", ros_reference: args.rosReference,
    submitted_at: agora, submitted_by: args.userId ?? null,
    notes: args.notes ?? null, updated_at: agora,
  }, { onConflict: "client_id,year,period_no,freq_type" }).select("id").maybeSingle();
  if (error) return { ok: false, erro: error.message };

  const psrId = (cab as any)?.id;
  if (!psrId) return { ok: false, erro: "Nao foi possivel gravar o cabecalho." };

  // Regravam-se as linhas por inteiro: o cabeçalho é único por período, e uma
  // linha órfã de um rascunho anterior seria uma pessoa comunicada a mais.
  await sb.from("hr_psr_line").delete().eq("psr_id", psrId);
  const { error: e2 } = await sb.from("hr_psr_line").insert(s.linhas.map((l) => ({
    psr_id: psrId, employee_id: l.employeeId,
    pps_number: l.pps, employment_id: l.employmentId, employee_name: l.nome,
    gross_cents: l.brutoCents, taxable_cents: l.tributavelCents,
    paye_cents: l.payeCents, usc_cents: l.uscCents,
    prsi_ee_cents: l.prsiEmpregadoCents, prsi_er_cents: l.prsiEmpregadorCents,
    prsi_class: l.classePRSI, insurable_weeks: l.semanasSeguraveis,
    ae_ee_cents: l.aeEmpregadoCents, ae_er_cents: l.aeEmpregadorCents,
  })));
  if (e2) return { ok: false, erro: e2.message };

  /*
   * O TIQUE DO ROS no controlo semanal passa a ser consequência, e não memória.
   *
   * A grelha semanal já tinha uma coluna `ros` que alguém marcava à mão — e uma
   * marca à mão diz que alguém se lembrou, não que aconteceu. Agora quem a
   * marca é o registo da submissão.
   */
  for (const semana of semanasDoPeriodo(args.freqType, args.year, args.periodNo)) {
    await sb.from("hr_weeks").upsert({
      client_id: args.clientId, year: args.year, week_no: semana,
      freq_type: args.freqType, ros: "done", updated_at: agora,
    }, { onConflict: "client_id,year,week_no,freq_type" });
  }

  return { ok: true, linhas: s.linhas.length };
}
