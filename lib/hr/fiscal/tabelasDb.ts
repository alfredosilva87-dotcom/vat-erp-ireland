import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { tabelaDoAno as tabelaDeFabrica, type TabelaAno } from "@/lib/hr/fiscal/tabelas";

/**
 * As tabelas fiscais VINDAS DO CADASTRO.
 *
 * ---------------------------------------------------------------------------
 * QUEM MANDA
 *
 * O banco manda sempre que tem linha para o ano. `lib/hr/fiscal/tabelas.ts`
 * fica como **semente e recurso**: uma instalação nova nasce com números, e uma
 * leitura que falhe não deixa a folha sem tabela nenhuma.
 *
 * Isto não é duplicação — é a diferença entre "valor de fábrica" e "valor em
 * uso". A migração 048 semeia o banco a partir dos mesmos números, com
 * `on conflict do nothing`: quem já editou a tabela no ecrã **não a vê voltar
 * ao valor de fábrica** na actualização seguinte, que seria a forma mais rápida
 * de perder a confiança no cadastro.
 *
 * ---------------------------------------------------------------------------
 * A CACHE, E POR QUE ELA É CURTA
 *
 * A folha de um cliente com 30 pessoas chama isto 30 vezes seguidas, e são
 * sempre as mesmas três leituras. Mas a tabela é EDITÁVEL: uma cache longa
 * faria alguém corrigir a taxa no ecrã, recalcular, e ver o número velho — e
 * concluir que a edição não funciona.
 *
 * Trinta segundos servem a folha inteira e não sobrevivem a um `Guardar`
 * seguido de um `Recalcular`.
 */

const VALIDADE_MS = 30_000;
const cache = new Map<number, { em: number; t: TabelaAno }>();

/** Deitar fora depois de gravar, para o recálculo seguinte ler o que se gravou. */
export function esquecerTabela(ano?: number) {
  if (ano === undefined) cache.clear();
  else cache.delete(ano);
}

export async function tabelaDoBanco(ano: number): Promise<{ tabela: TabelaAno; deFabrica: boolean }> {
  const guardada = cache.get(ano);
  if (guardada && Date.now() - guardada.em < VALIDADE_MS) {
    return { tabela: guardada.t, deFabrica: false };
  }

  const sb = getServerSupabase();
  const [{ data: cab }, { data: bandas }, { data: prsi }, { data: ae }] = await Promise.all([
    sb.from("hr_tax_year").select("*").eq("year", ano).maybeSingle(),
    sb.from("hr_usc_band").select("*").eq("year", ano).order("ord", { ascending: true }),
    sb.from("hr_prsi_rate").select("*").eq("year", ano).order("effective_from", { ascending: true }),
    /*
     * O auto-enrolment NAO e por ano: e uma escada de degraus com datas, e um
     * degrau que comeca em 2029 vale de 2029 em diante. Por isso le-se a linha
     * mais recente que ja entrou em vigor, e nao a "linha de 2026".
     */
    sb.from("hr_ae_rate").select("*")
      .lte("effective_from", `${ano}-12-31`)
      .order("effective_from", { ascending: false }).limit(1),
  ]);

  /*
   * Sem linha para o ano cai-se na fábrica — e diz-se.
   *
   * Rebentar aqui deixava o escritório sem folha por causa de um ano que
   * ninguém ainda cadastrou, o que é sempre pior do que calcular com a tabela
   * do ano anterior e avisar. O `deFabrica` sobe até ao ecrã.
   */
  const linhasPrsi = (prsi ?? []) as any[];
  if (!cab || !linhasPrsi.length) {
    return { tabela: tabelaDeFabrica(ano).tabela, deFabrica: true };
  }

  const c = cab as any;
  const banda = (reduzida: boolean) => ((bandas ?? []) as any[])
    .filter((b) => !!b.reduced === reduzida)
    .map((b) => ({ ate: b.upto_cents === null ? null : Number(b.upto_cents), taxaBps: b.rate_bps }));

  const normais = banda(false);
  const reduzidas = banda(true);
  const tabela: TabelaAno = {
    ano,
    paye: {
      taxaNormalBps: c.rate_standard_bps,
      taxaSuperiorBps: c.rate_higher_bps,
      cutOff: {
        solteiro: Number(c.cutoff_single_cents),
        familiaMonoparental: Number(c.cutoff_lone_parent_cents),
        casadoUmSalario: Number(c.cutoff_married_one_cents),
        casadoDoisSalarios: Number(c.cutoff_married_two_cents),
        acrescimoMax: Number(c.cutoff_transfer_max_cents),
      },
      creditos: {
        pessoalSolteiro: Number(c.credit_personal_single_cents),
        pessoalCasado: Number(c.credit_personal_married_cents),
        empregado: Number(c.credit_employee_cents),
        familiaMonoparental: Number(c.credit_lone_parent_cents),
      },
      emergencia: {
        semanasComCutOff: c.emergency_weeks_with_cutoff,
        cutOffSemanal: Number(c.emergency_weekly_cutoff_cents),
      },
    },
    usc: {
      // Uma banda sem topo tem de existir, senão rendimento alto ficava por
      // tributar em silêncio — o pior tipo de falha nisto.
      bandas: normais.length ? normais : tabelaDeFabrica(ano).tabela.usc.bandas,
      isencaoAnual: Number(c.usc_exemption_annual_cents),
      bandasReduzidas: reduzidas.length ? reduzidas : tabelaDeFabrica(ano).tabela.usc.bandasReduzidas,
      limiteReduzidas: Number(c.usc_reduced_limit_cents),
    },
    prsi: linhasPrsi.map((p) => ({
      desde: String(p.effective_from).slice(0, 10),
      empregadoBps: p.employee_bps,
      isencaoSemanal: Number(p.employee_exempt_weekly_cents),
      credito: {
        maximo: Number(p.credit_max_cents),
        ateSemanal: Number(p.credit_upto_weekly_cents),
      },
      empregadorInferiorBps: p.employer_lower_bps,
      empregadorSuperiorBps: p.employer_higher_bps,
      empregadorLimiteSemanal: Number(p.employer_threshold_weekly_cents),
    })),
    ae: ((ae ?? []) as any[]).length ? (() => {
      const a = (ae as any[])[0];
      return {
        desde: String(a.effective_from).slice(0, 10),
        empregadoBps: a.employee_bps, empregadorBps: a.employer_bps, estadoBps: a.state_bps,
        rendimentoMinimoAnual: Number(a.min_annual_earnings_cents),
        tectoRendimento: Number(a.earnings_cap_cents),
        idadeMinima: a.min_age, idadeMaxima: a.max_age,
      };
    })() : null,
    confirmadoEm: c.confirmed_at ? String(c.confirmed_at).slice(0, 10) : null,
    fonte: c.source || "",
  };

  cache.set(ano, { em: Date.now(), t: tabela });
  return { tabela, deFabrica: false };
}
