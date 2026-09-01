import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole, getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { partidasOrfasDoCliente } from "@/lib/accounting/partidasOrfas";
import { removerLancamento } from "@/lib/accounting/limpeza";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A LIMPEZA DO RAZÃO — o que se pode tirar, e o que já se tirou.
 *
 * GET devolve três coisas, e as três são precisas ao mesmo tempo:
 *
 *   `orfas`      o lixo detectado sozinho — partida cuja origem já não existe.
 *   `procuradas` o resultado da busca, para o erro que a detecção não apanha
 *                (um lançamento certo no sítio errado continua a ter origem).
 *   `historico`  o que já saiu, e por quem. É o que faz de "apagar" uma
 *                decisão registada em vez de um buraco.
 */

const LIMITE = 200;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sb = getServerSupabase();
  const u = new URL(req.url);
  const de = u.searchParams.get("from");
  const ate = u.searchParams.get("to");
  const termo = (u.searchParams.get("q") || "").trim();
  const conta = (u.searchParams.get("account") || "").trim();

  const orfas = await partidasOrfasDoCliente(params.id);

  /*
   * A BUSCA só corre quando lhe deram um recorte.
   *
   * Sem isto, abrir a tela devolvia o razão inteiro numa lista de onde se
   * apagam lançamentos — o que é o contrário do que se quer de uma tela
   * destrutiva. Ela abre com o lixo detectado, e o resto procura-se.
   */
  let procuradas: any[] = [];
  if (de || ate || termo || conta) {
    let q = sb.from("journal_lines")
      .select("account_code,debit,credit,journal!inner(id,posting_date,source_module,document_id,document_ref,description,client_id,reverses)")
      .eq("journal.client_id", params.id);
    if (de) q = q.gte("journal.posting_date", de);
    if (ate) q = q.lte("journal.posting_date", ate);
    if (conta) q = q.eq("account_code", conta);
    if (termo) q = q.or(`document_ref.ilike.%${termo}%,description.ilike.%${termo}%`, { foreignTable: "journal" });

    const { data, error } = await q.limit(5000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const porLanc = new Map<string, any>();
    for (const l of ((data ?? []) as any[])) {
      const j = l.journal;
      const a = porLanc.get(j.id) ?? {
        journalId: j.id, postingDate: j.posting_date, sourceModule: j.source_module,
        documentId: j.document_id, documentRef: j.document_ref,
        description: j.description, ehEstorno: !!j.reverses, contas: [] as any[],
      };
      a.contas.push({ code: l.account_code, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 });
      porLanc.set(j.id, a);
    }
    const orfaSet = new Set(orfas.map((o) => o.journalId));
    procuradas = [...porLanc.values()]
      .map((p) => ({ ...p, orfa: orfaSet.has(p.journalId) }))
      .sort((a, b) => (a.postingDate < b.postingDate ? 1 : -1))
      .slice(0, LIMITE);
  }

  const { data: historico } = await sb.from("journal_removals")
    .select("id,journal_id,action,reason,note,removed_at,reversal_journal_id,snapshot")
    .eq("client_id", params.id).order("removed_at", { ascending: false }).limit(50);

  return NextResponse.json({
    orfas,
    procuradas,
    buscou: !!(de || ate || termo || conta),
    historico: ((historico ?? []) as any[]).map((h) => ({
      id: h.id, journalId: h.journal_id, action: h.action, reason: h.reason,
      note: h.note, removedAt: h.removed_at, reversalJournalId: h.reversal_journal_id,
      // A tela mostra o que saiu, e não o JSON inteiro: data, descrição e
      // valor chegam para reconhecer o lançamento.
      postingDate: h.snapshot?.cabecalho?.posting_date ?? null,
      documentRef: h.snapshot?.cabecalho?.document_ref ?? null,
      description: h.snapshot?.cabecalho?.description ?? null,
      total: ((h.snapshot?.linhas ?? []) as any[])
        .reduce((s, l) => s + (Number(l.debit) || 0), 0),
    })),
  });
}

/**
 * Tirar um ou vários lançamentos do razão.
 *
 * ADMIN, e não qualquer utilizador com acesso à tela. Apagar movimento do razão
 * é a operação mais destrutiva que este sistema tem, e o menu esconder o botão
 * não é uma permissão — a verificação tem de estar aqui para existir.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.journalIds) ? body.journalIds.map(String) : [];
  const acao = body?.action === "delete" ? "delete" : "reverse";
  const motivo = String(body?.reason || "manual");
  const nota = String(body?.note || "").trim();

  if (!ids.length) return NextResponse.json({ error: "Nada selecionado." }, { status: 400 });
  /*
   * A NOTA é obrigatória, e não é burocracia.
   *
   * Um lançamento que sai do razão sem uma frase a dizer porque saiu volta a
   * ser exactamente o mistério que esta tela existe para acabar — só que desta
   * vez sem sequer a partida para investigar.
   */
  if (nota.length < 3) {
    return NextResponse.json(
      { error: "Escreva porque está a remover — fica no registo, e é o que explica isto daqui a seis meses." },
      { status: 400 }
    );
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: "No máximo 100 de cada vez." }, { status: 400 });
  }

  const user = await getSessionUser();

  /*
   * Um a um, e o que falha NÃO trava os outros.
   *
   * Um lote de vinte em que o terceiro está num período fechado não pode
   * devolver a pessoa ao princípio: as outras dezanove são trabalho feito. Cada
   * falha volta com o motivo, para a tela dizer qual e porquê.
   */
  const feitos: string[] = [];
  const falhas: { journalId: string; erro: string }[] = [];
  for (const id of ids) {
    const r = await removerLancamento({
      clientId: params.id, journalId: id, acao,
      motivo, nota, userId: user?.id ?? null,
    });
    if (r.ok) feitos.push(id);
    else falhas.push({ journalId: id, erro: r.erro || "Falhou." });
  }

  return NextResponse.json({ ok: true, acao, removidos: feitos.length, feitos, falhas });
}
