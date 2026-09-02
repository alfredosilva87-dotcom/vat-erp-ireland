import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { lerCsv } from "@/lib/hr/importPuro";
import { tabelaDoBanco } from "@/lib/hr/fiscal/tabelasDb";
import { calcular, type Base, type Situacao } from "@/lib/hr/fiscal/motor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Importar funcionários e acumulados de outro sistema de folha.
 *
 * ---------------------------------------------------------------------------
 * O QUE TORNA A TROCA SEGURA NÃO É A IMPORTAÇÃO — É A CONFERÊNCIA
 *
 * Importar acumulados errados **não dá erro nenhum**: a primeira folha sai
 * plausível, e a diferença aparece meses depois na conta da Revenue. Uma coluna
 * trocada entre "USC paid" e "PRSI paid" produz números que parecem certos.
 *
 * Por isso o `preview` não se limita a ler. Para cada pessoa com acumulado, ele
 * **refaz o imposto com o próprio motor** e compara com o que o ficheiro diz.
 * Se o CSV afirma 1.755,70 de PAYE sobre 22.241,26 na semana 35, o motor tem de
 * chegar ao mesmo número — e chega, porque já foi provado contra um payslip
 * real. Quando não chega, alguma coisa está trocada, e apanha-se ANTES de
 * gravar seja o que for.
 */

type Corpo = { csv?: string; year?: number; commit?: boolean };

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  // Carregar gente e acumulados é o acto que decide a folha de um ano inteiro.
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = (await req.json().catch(() => ({}))) as Corpo;
  const ano = Number(body.year) || new Date().getFullYear();
  const texto = String(body.csv ?? "");
  if (!texto.trim()) return NextResponse.json({ error: "Ficheiro vazio." }, { status: 400 });

  const leitura = lerCsv(texto, ano);
  if (!leitura.ok) return NextResponse.json({ error: leitura.erro }, { status: 400 });

  const sb = getServerSupabase();
  const { data: existentes } = await sb.from("hr_employees")
    .select("id,first_name,surname,pps_number,code").eq("client_id", params.id);
  const jaCa = ((existentes ?? []) as any[]);

  /*
   * Casar por PPS primeiro, e só depois por nome.
   *
   * O PPS é a identidade fiscal e não muda; o nome escreve-se de cinco maneiras
   * e muda com um casamento. Casar por nome primeiro criava duplicados a cada
   * importação — e um duplicado num sistema de folha é uma pessoa a receber
   * duas vezes.
   */
  const porPps = new Map(jaCa.filter((e) => e.pps_number).map((e) => [e.pps_number, e]));
  const porNome = new Map(jaCa.map((e) =>
    [`${e.first_name ?? ""} ${e.surname ?? ""}`.trim().toLowerCase(), e]));

  const { tabela } = await tabelaDoBanco(ano);

  const linhas = leitura.linhas.map((l) => {
    const d: any = l.dados;
    const existente = (d.pps_number && porPps.get(d.pps_number))
      || porNome.get(`${d.first_name ?? ""} ${d.surname ?? ""}`.trim().toLowerCase())
      || null;

    /*
     * A CONFERÊNCIA. Refaz-se o imposto e compara-se com o ficheiro.
     *
     * Precisa das semanas seguráveis para saber em que período do ano o
     * acumulado está — sem isso não há como pro-ratear o cut-off, e a conta não
     * se pode fazer. Diz-se, em vez de conferir com um palpite.
     */
    let conferencia: any = null;
    const bruto = Number(d.ytd_opening_gross_cents ?? 0);
    const semanas = Number(d.insurable_weeks ?? 0);
    if (bruto > 0 && semanas > 0) {
      const porAno = d.freq_type === "monthly" ? 12 : d.freq_type === "fortnightly" ? 26 : 52;
      const periodo = d.freq_type === "monthly" ? Math.round(semanas / 4.333)
        : d.freq_type === "fortnightly" ? Math.round(semanas / 2) : semanas;
      const r = calcular({
        // Trata-se o acumulado inteiro como um único período: o cumulativo dá o
        // imposto DEVIDO até ali, que é exactamente o que o ficheiro afirma.
        brutoPeriodo: bruto,
        dataPagamento: `${ano}-12-31`,
        periodosNoAno: porAno as 52 | 26 | 12,
        periodoNo: Math.max(1, Math.min(periodo, porAno)),
        base: (d.tax_basis || "cumulativa") as Base,
        situacao: (d.marital_status || "solteiro") as Situacao,
        rpn: d.rpn_cutoff_cents || d.rpn_credits_cents
          ? { cutOffAnual: d.rpn_cutoff_cents ?? undefined, creditosAnuais: d.rpn_credits_cents ?? undefined }
          : null,
        acumuladoAnterior: null,
      }, tabela);

      const difPaye = r.paye - Number(d.ytd_opening_paye_cents ?? 0);
      const difUsc = r.usc - Number(d.ytd_opening_usc_cents ?? 0);
      conferencia = {
        payeFicheiro: Number(d.ytd_opening_paye_cents ?? 0), payeMotor: r.paye, difPaye,
        uscFicheiro: Number(d.ytd_opening_usc_cents ?? 0), uscMotor: r.usc, difUsc,
        // Um euro de folga: o outro sistema arredonda por período e nós
        // refazemos de uma vez, então cêntimos de diferença são normais.
        bate: Math.abs(difPaye) <= 100 && Math.abs(difUsc) <= 100,
      };
    }

    return {
      linha: l.numeroDaLinha,
      nome: `${d.first_name ?? ""} ${d.surname ?? ""}`.trim(),
      dados: d,
      erro: l.erro,
      avisos: l.avisos,
      acao: l.erro ? "ignorar" : existente ? "actualizar" : "criar",
      existenteId: existente?.id ?? null,
      conferencia,
    };
  });

  if (!body.commit) {
    return NextResponse.json({
      previa: true, ignoradas: leitura.ignoradas, reconhecidas: leitura.reconhecidas, linhas,
    });
  }

  // ------------------------------------------------------------------ gravar
  const bons = linhas.filter((l) => !l.erro);
  let criados = 0, actualizados = 0;
  const falhas: { linha: number; nome: string; erro: string }[] = [];

  for (const l of bons) {
    // `insurable_weeks` não é coluna de `hr_employees` — serviu a conferência.
    const { insurable_weeks, ...campos } = l.dados as any;
    const r = l.existenteId
      ? await sb.from("hr_employees").update(campos).eq("id", l.existenteId).eq("client_id", params.id)
      : await sb.from("hr_employees").insert({ ...campos, client_id: params.id });
    if (r.error) falhas.push({ linha: l.linha, nome: l.nome, erro: r.error.message });
    else if (l.existenteId) actualizados++;
    else criados++;
  }

  return NextResponse.json({ ok: true, criados, actualizados, falhas });
}
