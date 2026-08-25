import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";
import { periodoDoAno } from "@/lib/accounting/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * De onde vem um número do relatório.
 *
 * Devolve os lançamentos que formam o saldo de uma conta, cada um com o
 * documento de origem. É o que fecha a promessa do motor: qualquer valor
 * do DRE ou do balanço se rastreia até a nota, o fornecedor e o
 * movimento bancário.
 *
 * Sem isto, um DRE que surpreende só se investiga por SQL. E um
 * relatório que ninguém consegue explicar é um relatório em que ninguém
 * confia — o contador refaz a conta na planilha dele, e o sistema vira
 * enfeite caro.
 *
 * O recorte de data acompanha o do relatório: o DRE olha o MOVIMENTO do
 * período, o balanço olha o ACUMULADO. `from` ausente quer dizer
 * acumulado, que é o caso do balanço.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const conta = sp.get("account");
  if (!conta) return NextResponse.json({ error: "Missing account." }, { status: 400 });

  const ano = Number(sp.get("year")) || new Date().getFullYear();
  const padrao = periodoDoAno(ano);
  const ate = sp.get("to") || padrao.ate;
  const de = sp.get("from");

  const sb = getServerSupabase();
  const LIMITE = 500;

  const { data } = await sb
    .from("journal_lines")
    .select(
      "id,debit,credit,description,resolved_by,counterparty,vat_amount,net_amount," +
      "journal:journal_id(id,entry_date,posting_date,source_module,document_id,document_ref,description,client_id)"
    )
    .eq("account_code", conta)
    .limit(LIMITE);

  /*
   * O filtro por cliente e por data acontece aqui, e não na consulta.
   *
   * Ambos vivem no CABEÇALHO do lançamento, e filtrar por tabela juntada
   * no PostgREST exige `!inner`, que muda o formato da resposta e
   * silenciosamente descarta linhas cujo cabeçalho não casou. Trazer e
   * filtrar em memória é mais lento e não mente — e são 500 linhas.
   */
  const linhas = ((data ?? []) as any[])
    .filter((l) => l.journal && l.journal.client_id === params.id)
    .filter((l) => l.journal.posting_date <= ate)
    .filter((l) => !de || l.journal.posting_date >= de)
    .map((l) => ({
      id: l.id,
      date: l.journal.posting_date,
      entryDate: l.journal.entry_date,
      sourceModule: l.journal.source_module,
      documentId: l.journal.document_id,
      documentRef: l.journal.document_ref,
      journalId: l.journal.id,
      counterparty: l.counterparty ?? l.journal.description,
      description: l.description ?? l.journal.description,
      /** Qual elo da cadeia escolheu esta conta — a resposta do "por quê". */
      resolvedBy: l.resolved_by,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      vatAmount: l.vat_amount == null ? null : Number(l.vat_amount),
      netAmount: l.net_amount == null ? null : Number(l.net_amount),
    }))
    .sort((a, b) =>
      a.date.localeCompare(b.date) ||
      String(a.documentRef ?? "").localeCompare(String(b.documentRef ?? ""))
    );

  const { data: info } = await sb
    .from("chart_of_accounts")
    .select("code,description,type,report_group")
    .eq("code", conta)
    .maybeSingle();

  const debit = Math.round(linhas.reduce((s, l) => s + l.debit, 0) * 100) / 100;
  const credit = Math.round(linhas.reduce((s, l) => s + l.credit, 0) * 100) / 100;
  const tipo = (info as any)?.type;
  const balance =
    Math.round((["asset", "expense"].includes(tipo) ? debit - credit : credit - debit) * 100) / 100;

  return NextResponse.json({
    account: info ?? { code: conta },
    from: de, to: ate,
    entries: linhas,
    debit, credit, balance,
    // Cortar em silêncio faria o detalhe não somar o saldo do relatório,
    // e a pessoa passaria a tarde a procurar um erro que não existe.
    truncated: (data ?? []).length >= LIMITE,
  });
}
