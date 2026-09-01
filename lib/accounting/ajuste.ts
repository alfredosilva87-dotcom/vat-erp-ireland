import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { periodoTravado } from "@/lib/accounting/periodos";
import { removerLancamento } from "@/lib/accounting/limpeza";
import { criticarAjuste, houveMudanca, type LinhaDoAjuste } from "@/lib/accounting/ajustePuro";

/**
 * AJUSTAR a partida de um documento: estornar e relançar.
 *
 * A regra de o que é um lançamento válido vive em `ajustePuro.ts`. Aqui é o
 * lado com banco: ler o original, conferir o período, estornar, relançar, e
 * pendurar o título na partida nova.
 */

export type Ajuste = {
  ok: boolean;
  erro?: string;
  estornoId?: string | null;
  novoId?: string | null;
};

const hoje = () => new Date().toISOString().slice(0, 10);

export type PartidaLida = {
  journalId: string;
  postingDate: string;
  entryDate: string;
  sourceModule: string;
  documentId: string | null;
  documentRef: string | null;
  description: string | null;
  ehEstorno: boolean;
  jaEstornado: boolean;
  periodoFechado: boolean;
  linhas: (LinhaDoAjuste & { line_no: number })[];
};

/** A partida como está, mais o que a tela precisa de saber antes de deixar mexer. */
export async function lerPartida(clientId: string, journalId: string): Promise<PartidaLida | null> {
  const sb = getServerSupabase();
  const { data: cab } = await sb.from("journal")
    .select("id,posting_date,entry_date,source_module,document_id,document_ref,description,reverses")
    .eq("id", journalId).eq("client_id", clientId).maybeSingle();
  if (!cab) return null;
  const c = cab as any;

  const [{ data: linhas }, { data: espelho }] = await Promise.all([
    sb.from("journal_lines").select("line_no,account_code,debit,credit,description")
      .eq("journal_id", journalId).order("line_no", { ascending: true }),
    sb.from("journal").select("id").eq("reverses", journalId).maybeSingle(),
  ]);

  const data = String(c.posting_date).slice(0, 10);
  return {
    journalId: c.id, postingDate: data, entryDate: String(c.entry_date).slice(0, 10),
    sourceModule: c.source_module, documentId: c.document_id, documentRef: c.document_ref,
    description: c.description, ehEstorno: !!c.reverses, jaEstornado: !!espelho,
    periodoFechado: (await periodoTravado(clientId, data, data)).fechado,
    linhas: ((linhas ?? []) as any[]).map((l) => ({
      line_no: l.line_no, account_code: l.account_code,
      debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
      description: l.description,
    })),
  };
}

export async function ajustarLancamento(args: {
  clientId: string;
  journalId: string;
  linhas: LinhaDoAjuste[];
  nota: string;
  userId?: string | null;
}): Promise<Ajuste> {
  const sb = getServerSupabase();

  const atual = await lerPartida(args.clientId, args.journalId);
  if (!atual) return { ok: false, erro: "Lançamento não encontrado neste cliente." };
  if (atual.ehEstorno) {
    return { ok: false, erro: "Isto é um estorno. Ajuste o lançamento original, não o espelho dele." };
  }
  if (atual.jaEstornado) {
    return { ok: false, erro: "Este lançamento já foi estornado — ajuste a correcção que ficou no lugar dele." };
  }

  /*
   * As CONTAS válidas: existem no plano, activas e analíticas.
   *
   * O plano é partilhado (`client_id is null`) mais as contas próprias deste
   * cliente. `postable` e `type` não são detalhe: o `trial_balance` faz `left
   * join`, e uma conta sem natureza faz a linha ser descartada do balancete e
   * do balanço em silêncio, com o lançamento a continuar lá, balanceado. É a
   * avaria que a Verificação apanha depois; aqui recusa-se antes de existir.
   */
  const { data: plano } = await sb.from("chart_of_accounts")
    .select("code,active,postable,type")
    .or(`client_id.is.null,client_id.eq.${args.clientId}`);
  const validas = new Set(((plano ?? []) as any[])
    .filter((c) => c.active && c.postable && c.type).map((c) => String(c.code)));

  const critica = criticarAjuste(args.linhas, validas);
  if (!critica.ok) return { ok: false, erro: critica.erro };

  if (!houveMudanca(atual.linhas, critica.linhas)) {
    // Três partidas onde havia uma, e nenhuma delas muda um número: só suja o
    // razão e o histórico com trabalho que não aconteceu.
    return { ok: false, erro: "As linhas estão iguais às que já lá estavam — não há nada a ajustar." };
  }

  /*
   * A DATA da correcção acompanha a do estorno, e as duas seguem o período.
   *
   * Período aberto: as três partidas ficam na data original, e o mês continua a
   * dizer a verdade sobre si próprio. Período fechado: as duas novas vão para
   * hoje, porque reescrever um mês entregue é precisamente o que o cadeado
   * existe para impedir — o efeito da correcção aparece no mês em que ela foi
   * decidida, que é como se corrige contabilidade fechada.
   */
  const data = atual.periodoFechado ? hoje() : atual.postingDate;
  if (atual.periodoFechado && (await periodoTravado(args.clientId, data, data)).fechado) {
    return { ok: false, erro: "O período de hoje também está fechado — reabra um deles para poder ajustar." };
  }

  const estorno = await removerLancamento({
    clientId: args.clientId, journalId: args.journalId, acao: "reverse",
    motivo: "adjust", nota: args.nota, userId: args.userId,
    // O espelho fica preso ao MESMO documento: é o que faz o razão recortado
    // naquele documento mostrar original, anulação e correcção juntos.
    manterDocumento: true,
  });
  if (!estorno.ok) return { ok: false, erro: estorno.erro };

  const { data: cab, error: e1 } = await sb.from("journal").insert({
    client_id: args.clientId,
    entry_date: data, posting_date: data,
    source_module: atual.sourceModule,
    document_id: atual.documentId,
    document_ref: atual.documentRef,
    description: `Ajuste — ${atual.description ?? atual.documentRef ?? ""}`.trim(),
    created_by: args.userId ?? null,
  }).select("id").single();
  if (e1 || !cab) {
    /*
     * A correcção falhou depois de o estorno já ter entrado.
     *
     * Deixar assim seria pior do que não ter mexido: o documento ficava com
     * efeito ZERO no razão — anulado e sem substituto — e ninguém saberia
     * porquê. Desfaz-se o estorno para o razão voltar exactamente ao que era.
     */
    if (estorno.estornoId) await sb.from("journal").delete().eq("id", estorno.estornoId);
    await sb.from("journal_removals").delete().eq("journal_id", args.journalId).eq("reason", "adjust");
    return { ok: false, erro: e1?.message || "Não criou a partida corrigida." };
  }
  const novoId = (cab as any).id as string;

  const { error: e2 } = await sb.from("journal_lines").insert(
    critica.linhas.map((l, i) => ({
      journal_id: novoId, line_no: i + 1,
      account_code: l.account_code, debit: l.debit, credit: l.credit,
      description: l.description, resolved_by: "adjust",
    }))
  );
  if (e2) {
    await sb.from("journal").delete().eq("id", novoId);
    if (estorno.estornoId) await sb.from("journal").delete().eq("id", estorno.estornoId);
    await sb.from("journal_removals").delete().eq("journal_id", args.journalId).eq("reason", "adjust");
    return { ok: false, erro: e2.message };
  }

  /*
   * O TÍTULO passa a apontar para a partida nova.
   *
   * `ledger_items.journal_id` é o que leva do aging de volta ao razão. Deixá-lo
   * na partida original mandaria quem clicasse para o lançamento que acabou de
   * ser anulado — tecnicamente ainda lá, e a dizer o número antigo.
   */
  await sb.from("ledger_items").update({ journal_id: novoId })
    .eq("client_id", args.clientId).eq("journal_id", args.journalId);

  return { ok: true, estornoId: estorno.estornoId ?? null, novoId };
}
