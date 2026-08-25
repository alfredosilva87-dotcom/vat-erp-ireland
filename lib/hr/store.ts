import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import type { CellState, FreqType } from "@/lib/hr/payroll";

/**
 * A leitura do módulo RH.
 *
 * Uma consulta só serve as quatro telas de escritório — painel, controlo
 * semanal, empresas na folha e comunicação — porque todas fazem a MESMA
 * pergunta: quais empresas fazem folha, com que configuração, e em que estado
 * está cada semana do ano. Quatro endpoints quase iguais acabariam a discordar
 * no dia em que alguém corrigisse um e esquecesse os outros; foi assim que o
 * sistema de origem chegou a ter dois painéis com contas diferentes para a
 * mesma semana, e o comentário dele diz isso com todas as letras.
 *
 * O cliente vem do cadastro RAIZ (`clients`) — não há aqui um segundo registo
 * de empresas. `hr_client` guarda só o que é configuração de folha, e uma
 * empresa sem linha lá simplesmente não faz folha.
 */

export type HrCompany = {
  id: string;
  client_code: string | null;
  name: string;
  status: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  employee_count: number;
  freq_weekly: boolean;
  freq_fortnightly: boolean;
  freq_monthly: boolean;
  pay_day: string | null;
  hours_source: string | null;
  payroll_config: {
    freq_type: FreqType;
    issue_day: string | null;
    week_offset: number;
    tracked_year: number | null;
    tracked_week: number | null;
  }[];
  /** semana → tipo de payslip → os quatro estados */
  weeks: Record<
    number,
    Record<string, { payslip: CellState; er: CellState; ee: CellState; ros: CellState }>
  >;
};

const sb = () => getServerSupabase();

/**
 * `allowed` vem de `visibleClientIds()`: `null` = pode ver tudo (perfil
 * master), lista = só esses. É o mesmo contrato do resto do ERP, e é o que
 * impede a folha de um escritório de aparecer noutro na cópia em nuvem.
 */
export async function listPayrollCompanies(
  allowed: string[] | null,
  year: number
): Promise<HrCompany[]> {
  const { data: cfgRows } = await sb().from("hr_client").select("*");
  const cfgs = (cfgRows ?? []) as any[];
  if (!cfgs.length) return [];

  let ids = cfgs.map((c) => c.client_id as string);
  if (allowed) {
    const permitidos = new Set(allowed);
    ids = ids.filter((id) => permitidos.has(id));
  }
  if (!ids.length) return [];

  const [{ data: clientRows }, { data: blocos }, { data: semanas }, { data: pessoal }] =
    await Promise.all([
      sb()
        .from("clients")
        .select("id,client_code,name,status,contact_person,email,phone")
        .in("id", ids),
      sb().from("hr_client_config").select("*").in("client_id", ids),
      sb()
        .from("hr_weeks")
        .select("client_id,week_no,freq_type,payslip,er,ee,ros")
        .eq("year", year)
        .in("client_id", ids),
      sb().from("hr_employees").select("client_id").eq("active", true).in("client_id", ids),
    ]);

  const cfgPorCliente = new Map(cfgs.map((c) => [c.client_id as string, c]));

  const quadro = new Map<string, number>();
  for (const e of (pessoal ?? []) as any[]) {
    quadro.set(e.client_id, (quadro.get(e.client_id) ?? 0) + 1);
  }

  const semanasPorCliente = new Map<string, HrCompany["weeks"]>();
  for (const w of (semanas ?? []) as any[]) {
    const m = semanasPorCliente.get(w.client_id) ?? {};
    m[w.week_no] = m[w.week_no] ?? {};
    m[w.week_no][w.freq_type] = { payslip: w.payslip, er: w.er, ee: w.ee, ros: w.ros };
    semanasPorCliente.set(w.client_id, m);
  }

  return ((clientRows ?? []) as any[])
    .map((c): HrCompany => {
      const cfg = cfgPorCliente.get(c.id) ?? {};
      return {
        id: c.id,
        client_code: c.client_code,
        name: c.name,
        status: c.status,
        contact_person: c.contact_person,
        email: c.email,
        phone: c.phone,
        employee_count: quadro.get(c.id) ?? 0,
        freq_weekly: !!cfg.freq_weekly,
        freq_fortnightly: !!cfg.freq_fortnightly,
        freq_monthly: !!cfg.freq_monthly,
        pay_day: cfg.pay_day ?? null,
        hours_source: cfg.hours_source ?? null,
        payroll_config: ((blocos ?? []) as any[])
          .filter((b) => b.client_id === c.id)
          .map((b) => ({
            freq_type: b.freq_type,
            issue_day: b.issue_day,
            week_offset: Number(b.week_offset ?? 0),
            tracked_year: b.tracked_year,
            tracked_week: b.tracked_week,
          })),
        weeks: semanasPorCliente.get(c.id) ?? {},
      };
    })
    // Inativo por último, e depois por código: é a ordem do sistema de origem,
    // e é a que o escritório já tem na cabeça.
    .sort(
      (a, b) =>
        (a.status === "Inactive" ? 1 : 0) - (b.status === "Inactive" ? 1 : 0) ||
        String(a.client_code || "").localeCompare(String(b.client_code || ""))
    );
}

/**
 * Grava um estado do controlo semanal, criando a linha se ainda não existir.
 *
 * O `upsert` pela chave (cliente, ano, semana, tipo) é o que permite a grade
 * abrir vazia: nenhuma linha é criada até alguém clicar num quadrado, e 35
 * empresas × 53 semanas × 3 tipos de linhas em branco não iam servir para nada.
 */
export async function setWeekState(
  clientId: string,
  year: number,
  week: number,
  freqType: string,
  campo: "payslip" | "er" | "ee" | "ros",
  valor: CellState,
  userId: string
): Promise<boolean> {
  const { error } = await sb().from("hr_weeks").upsert(
    {
      client_id: clientId,
      year,
      week_no: week,
      freq_type: freqType,
      [campo]: valor,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,year,week_no,freq_type" }
  );
  return !error;
}
