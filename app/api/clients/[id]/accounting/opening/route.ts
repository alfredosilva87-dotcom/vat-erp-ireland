import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import {
  applyMapping, conferir, parseTrialBalance, toOpeningLines,
} from "@/lib/accounting/opening";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A carga que o cliente já tem, se tiver. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sb = getServerSupabase();
  const { data } = await sb.from("opening_balances")
    .select("*").eq("client_id", params.id).maybeSingle();
  if (!data) return NextResponse.json({ opening: null, lines: [] });

  const { data: linhas } = await sb.from("journal_lines")
    .select("account_code,debit,credit,description")
    .eq("journal_id", (data as any).journal_id).order("line_no");

  return NextResponse.json({ opening: data, lines: linhas ?? [] });
}

/**
 * Carrega os saldos de abertura.
 *
 * `dryRun` devolve o que ACONTECERIA sem gravar nada. É como a tela
 * mostra o que não mapeou e se o balancete fecha, antes de a pessoa
 * decidir — carregar primeiro e conferir depois é como se põe um erro
 * de três casas no património de um cliente.
 *
 * Refazer é permitido e estorna a carga anterior. Duas cargas vivas
 * dariam património em dobro sem ninguém notar.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const user = await getSessionUser();

  const body = await req.json().catch(() => null);
  const texto = String(body?.text || "");
  const corte = String(body?.cutoffDate || "");
  const dryRun = body?.dryRun !== false;

  if (!texto.trim()) return NextResponse.json({ error: "Cole o balancete." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(corte)) {
    return NextResponse.json({ error: "Informe a data de corte." }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { data: mapaRows } = await sb.from("account_mapping")
    .select("external_code,account_code").eq("client_id", params.id);
  const mapa: Record<string, string> = {};
  for (const m of ((mapaRows ?? []) as any[])) mapa[m.external_code] = m.account_code;

  const { rows, ignored } = parseTrialBalance(texto);
  const { mapped, unmapped } = applyMapping(rows, mapa);
  const check = conferir(rows);
  const linhas = toOpeningLines(mapped);

  const previa = {
    read: rows.length, ignored,
    mapped: mapped.length,
    unmapped,
    check,
    lines: linhas,
    // Só se pode gravar quando o balancete do cliente fecha E não sobrou
    // conta sem destino. Carregar pela metade poria a diferença no NOSSO
    // razão, atribuída a nós.
    canSave: check.ok && unmapped.length === 0 && linhas.length > 0,
  };

  if (dryRun) return NextResponse.json({ dryRun: true, ...previa });
  if (!previa.canSave) {
    return NextResponse.json(
      { error: "A carga nao pode ser gravada: confira o balanco e o de-para.", ...previa },
      { status: 400 }
    );
  }

  // Refazer: estorna a carga anterior antes de criar a nova.
  const { data: anterior } = await sb.from("opening_balances")
    .select("id,journal_id").eq("client_id", params.id).maybeSingle();
  if (anterior) {
    if ((anterior as any).journal_id) {
      await sb.from("journal").delete().eq("id", (anterior as any).journal_id);
    }
    await sb.from("opening_balances").delete().eq("id", (anterior as any).id);
  }

  const { data: cabecalho, error: e1 } = await sb.from("journal").insert({
    client_id: params.id,
    entry_date: corte, posting_date: corte,
    source_module: "opening", document_id: null,
    description: body?.sourceNote ? String(body.sourceNote) : "Saldos de abertura",
    created_by: user?.id ?? null,
  }).select("id").single();
  if (e1 || !cabecalho) return NextResponse.json({ error: e1?.message || "Falhou." }, { status: 500 });

  const { error: e2 } = await sb.from("journal_lines").insert(
    linhas.map((l, i) => ({
      journal_id: (cabecalho as any).id, line_no: i + 1,
      account_code: l.account_code, debit: l.debit, credit: l.credit,
      description: l.description, resolved_by: "opening",
    }))
  );
  if (e2) {
    await sb.from("journal").delete().eq("id", (cabecalho as any).id);
    return NextResponse.json({ error: e2.message, ...previa }, { status: 400 });
  }

  await sb.from("opening_balances").insert({
    client_id: params.id, cutoff_date: corte,
    source_note: body?.sourceNote ? String(body.sourceNote) : null,
    journal_id: (cabecalho as any).id, created_by: user?.id ?? null,
  });

  return NextResponse.json({ saved: true, journalId: (cabecalho as any).id, ...previa });
}

/** Remove a carga — o lançamento vai junto. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sb = getServerSupabase();
  const { data } = await sb.from("opening_balances")
    .select("id,journal_id").eq("client_id", params.id).maybeSingle();
  if (!data) return NextResponse.json({ ok: true });

  if ((data as any).journal_id) await sb.from("journal").delete().eq("id", (data as any).journal_id);
  await sb.from("opening_balances").delete().eq("id", (data as any).id);
  return NextResponse.json({ ok: true });
}
