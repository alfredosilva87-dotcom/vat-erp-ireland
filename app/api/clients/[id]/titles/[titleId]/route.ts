import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";
import { trocarContaDeControlo } from "@/lib/accounting/service";
import { CONTAS_PADRAO } from "@/lib/accounting/post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Um título, com os encargos e as baixas que o formam. */
export async function GET(_req: NextRequest, { params }: { params: { id: string; titleId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sb = getServerSupabase();
  const { data: titulo } = await sb.from("ledger_items_open")
    .select("*").eq("client_id", params.id).eq("id", params.titleId).maybeSingle();
  if (!titulo) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [{ data: encargos }, { data: baixas }, { data: contas }] = await Promise.all([
    sb.from("ledger_charges").select("*").eq("ledger_item_id", params.titleId)
      .order("incurred_on", { ascending: true }),
    sb.from("ledger_settlements").select("id,settled_on,amount,bank_transaction_id,journal_id")
      .eq("ledger_item_id", params.titleId).order("settled_on", { ascending: true }),
    // As contas bancárias do cliente, para a baixa poder escolher de onde sai
    // (ou entra) o dinheiro.
    sb.from("bank_accounts").select("id,name,bank_name,currency,account_code")
      .eq("client_id", params.id).eq("active", true).order("name"),
  ]);

  /*
   * As CONTRAPARTIDAS — as partidas do razão que este título produziu.
   *
   * É a pergunta do Alfredo: "onde vejo a contrapartida de fornecedor, onde
   * grava os lançamentos contábeis?". Estavam gravadas desde sempre e não
   * havia por onde chegar até elas a partir do título; era preciso ir ao razão
   * e procurar. Aqui vêm as três origens juntas — o próprio documento, cada
   * encargo e cada baixa — porque é isso que forma a dívida.
   */
  const idsDeLancamento = [
    (titulo as any).journal_id,
    ...((baixas ?? []) as any[]).map((b) => b.journal_id),
  ].filter(Boolean) as string[];

  // Os encargos guardam o lançamento pelo `document_id`, não por coluna.
  const { data: dosEncargos } = ((encargos ?? []) as any[]).length
    ? await sb.from("journal").select("id")
        .eq("client_id", params.id).eq("source_module", "charge")
        .in("document_id", ((encargos ?? []) as any[]).map((e) => e.id))
    : { data: [] as any[] };
  idsDeLancamento.push(...((dosEncargos ?? []) as any[]).map((j) => j.id));

  const { data: partidas } = idsDeLancamento.length
    ? await sb.from("journal_lines")
        .select("id,journal_id,line_no,account_code,debit,credit,description," +
                "journal:journal_id(id,posting_date,source_module,description)")
        .in("journal_id", idsDeLancamento)
        .order("journal_id").order("line_no")
    : { data: [] as any[] };

  const { data: plano } = await sb.from("chart_of_accounts")
    .select("code,description").is("client_id", null);
  const nomeDaConta = new Map(((plano ?? []) as any[]).map((c) => [c.code, c.description]));

  const lancamentos = ((partidas ?? []) as any[]).map((l) => ({
    id: l.id, journalId: l.journal_id, accountCode: l.account_code,
    accountName: nomeDaConta.get(l.account_code) ?? l.account_code,
    debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
    date: l.journal?.posting_date ?? null,
    origin: l.journal?.source_module ?? null,
    description: l.description ?? l.journal?.description ?? null,
  }));

  return NextResponse.json({
    title: titulo, charges: encargos ?? [], settlements: baixas ?? [],
    bankAccounts: contas ?? [], entries: lancamentos,
  });
}

/**
 * Edita o que é do escritório decidir: a conta contábil, o vencimento, a nota.
 *
 * O VALOR ORIGINAL não se edita aqui de propósito — ele é o que estava no
 * documento. Diferença de valor entra como encargo, onde fica visível o quanto
 * e porquê. Corrigir o original apagaria a única coisa que se quer saber
 * depois: quanto era e quanto custou a mais.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; titleId: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  if ("account_code" in body) patch.account_code = String(body.account_code || "").trim() || null;
  if ("due_date" in body) {
    const d = String(body.due_date || "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return NextResponse.json({ error: "Data de vencimento invalida." }, { status: 400 });
    }
    patch.due_date = d || null;
  }
  if ("notes" in body) patch.notes = String(body.notes || "").trim() || null;
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });
  patch.updated_at = new Date().toISOString();

  const sb = getServerSupabase();

  /*
   * Mudar a conta de controlo ARRASTA os lançamentos que já existem.
   *
   * Sem isto, as partidas antigas ficavam na conta velha e as novas na nova:
   * nenhuma das duas fecharia, e a diferença apareceria no balancete sem nada
   * que apontasse a causa.
   */
  let linhasMovidas = 0;
  if ("account_code" in patch) {
    const { data: antes } = await sb.from("ledger_items")
      .select("kind,account_code").eq("id", params.titleId).eq("client_id", params.id).maybeSingle();
    if (antes) {
      const padrao = (antes as any).kind === "payable"
        ? CONTAS_PADRAO.tradeCreditors : CONTAS_PADRAO.tradeDebtors;
      const de = (antes as any).account_code || padrao;
      const para = (patch.account_code as string | null) || padrao;
      if (de !== para) linhasMovidas = await trocarContaDeControlo(params.titleId, de, para);
    }
  }

  const { error } = await sb.from("ledger_items")
    .update(patch).eq("id", params.titleId).eq("client_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, linhasMovidas });
}
