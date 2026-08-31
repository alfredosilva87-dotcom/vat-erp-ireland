import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { criarTituloManual } from "@/lib/accounting/service";
import { CONTAS_PADRAO } from "@/lib/accounting/post";

/**
 * O IMPOSTO APURADO VIRA UM TÍTULO A PAGAR.
 *
 * ---------------------------------------------------------------------------
 * O QUE FALTAVA ENTRE A APURAÇÃO E O PAGAMENTO
 *
 * O sistema sabia quanto se devia (a apuração) e sabia quando (a data da
 * obrigação), mas essas duas coisas viviam numa tela de leitura. Não havia
 * nada em contas a pagar — e é a lista de contas a pagar que alguém abre para
 * decidir o que sai do banco esta semana.
 *
 * O resultado prático: o VAT3 aparecia na agenda como prazo, e o dinheiro dele
 * não aparecia em lado nenhum até alguém se lembrar. Com título, entra na
 * mesma fila do resto e baixa-se pelo banco como qualquer outra dívida.
 * ---------------------------------------------------------------------------
 *
 * O LANÇAMENTO É DIFERENTE PARA OS DOIS IMPOSTOS, e não é um detalhe:
 *
 *   VAT     — a dívida JÁ existe. Cada venda creditou a conta de controlo, e o
 *             saldo dela é o que se deve. O título é só a vista financeira
 *             disso, e por isso NÃO gera partida nenhuma: gerar duplicaria o
 *             passivo, e o balanço passaria a dever duas vezes o mesmo imposto.
 *
 *   Imposto — a dívida NÃO existe até alguém a reconhecer. É um lançamento de
 *   sobre     fecho (DR despesa / CR passivo) que ninguém faz sozinho. Aqui o
 *   o lucro   título vem COM a partida, porque criá-lo sem ela poria uma dívida
 *             em contas a pagar que o balanço desconhece.
 */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** As contas do imposto sobre o lucro — as mesmas da conciliação. */
const CONTA_DESPESA_IMPOSTO = "501";
const CONTA_PASSIVO_IMPOSTO = "831";

export type TipoDeImposto = "vat" | "imposto";

export type PedidoDeTitulo = {
  clientId: string;
  tipo: TipoDeImposto;
  /** O período apurado, que também define qual obrigação se está a pagar. */
  de: string;
  ate: string;
  valor: number;
  /** Se vier vazio, procura-se na obrigação do período. */
  vencimento?: string | null;
  userId?: string | null;
};

export type ResultadoDoTitulo =
  | { ok: true; id: string; ref: string; vencimento: string; comPartida: boolean }
  | { ok: false; erro: string };

/**
 * A referência do título nomeia a obrigação que ele paga.
 *
 * É o que liga as duas telas sem uma tabela de ligação: quem vê "VAT3 Jan-Feb
 * 2026" em contas a pagar sabe de que declaração se trata, e a busca por esse
 * texto encontra o título a partir da agenda.
 */
function referencia(tipo: TipoDeImposto, periodo: string | null, de: string, ate: string): string {
  const rotulo = periodo?.trim() || `${de} a ${ate}`;
  return tipo === "vat" ? `VAT3 ${rotulo}` : `CT1 ${rotulo}`;
}

export async function criarTituloDeImposto(p: PedidoDeTitulo): Promise<ResultadoDoTitulo> {
  const valor = r2(Math.abs(p.valor));
  if (valor <= 0) {
    return { ok: false, erro: "Não há imposto a pagar neste período — o apurado é zero ou a recuperar." };
  }

  const sb = getServerSupabase();

  /*
   * A obrigação do período dá o VENCIMENTO e o nome do período.
   *
   * Sem ela inventaríamos uma data, e um vencimento inventado num título
   * aparece no aging como se fosse verdade — alguém pagaria no dia errado.
   * Por isso a data da obrigação manda, e só se pede uma à mão quando não há
   * obrigação nenhuma registada.
   */
  const kind = p.tipo === "vat" ? "VAT3" : "CT1";
  const { data: obrig } = await sb.from("obligations")
    .select("id,period_label,due_date")
    .eq("client_id", p.clientId).eq("kind", kind)
    .lte("period_start", p.ate).gte("period_end", p.de)
    .order("due_date", { ascending: true })
    .limit(1).maybeSingle();

  const vencimento = p.vencimento?.trim() || (obrig as any)?.due_date;
  if (!vencimento) {
    return {
      ok: false,
      erro: "Não há obrigação registada para este período, e sem ela não se sabe o vencimento. "
        + "Escolha uma data, ou gere as obrigações do ano primeiro.",
    };
  }

  const ref = referencia(p.tipo, (obrig as any)?.period_label ?? null, p.de, p.ate);

  /*
   * Um título por período, e não um por clique.
   *
   * Sem esta verificação, carregar duas vezes no botão criava duas dívidas do
   * mesmo imposto, e a segunda só apareceria a quem fosse pagar.
   */
  const { data: jaExiste } = await sb.from("ledger_items")
    .select("id").eq("client_id", p.clientId).eq("kind", "payable")
    .eq("document_ref", ref).maybeSingle();
  if (jaExiste) {
    return { ok: false, erro: `Já existe um título para ${ref}. Veja em contas a pagar.` };
  }

  const hoje = new Date().toISOString().slice(0, 10);

  // ---------------------------------------------------------------- VAT
  if (p.tipo === "vat") {
    // Sem partida: a conta de controlo já carrega esta dívida. Ver acima.
    const { data, error } = await sb.from("ledger_items").insert({
      client_id: p.clientId, kind: "payable", source_module: "manual",
      document_id: null, document_ref: ref,
      counterparty: "Revenue",
      issue_date: hoje, due_date: vencimento,
      original_amount: valor,
      // A conta de controlo do título: é para ela que a baixa pelo banco vai
      // debitar, e é o que faz o saldo de IVA voltar a zero quando se paga.
      account_code: CONTAS_PADRAO.vatPayable,
      notes: "Apuração de IVA do período. A dívida já está na conta de controlo — "
        + "este título é a vista de contas a pagar dela.",
    }).select("id").single();

    if (error || !data) return { ok: false, erro: error?.message || "Não criou o título." };
    return { ok: true, id: (data as any).id, ref, vencimento, comPartida: false };
  }

  // ------------------------------------------------- imposto sobre o lucro
  // COM partida: DR despesa de imposto / CR passivo de imposto. É o lançamento
  // de fecho, e sem ele o título seria uma dívida que o balanço desconhece.
  const r = await criarTituloManual({
    clientId: p.clientId, kind: "payable",
    counterparty: "Revenue",
    documentRef: ref,
    issueDate: hoje, dueDate: vencimento,
    amount: valor,
    resultAccount: CONTA_DESPESA_IMPOSTO,
    controlAccount: CONTA_PASSIVO_IMPOSTO,
    notes: "Imposto sobre o lucro do exercício, reconhecido com este título.",
    userId: p.userId ?? null,
  });
  if (!r.ok || !r.id) return { ok: false, erro: r.erro || "Não criou o título." };
  return { ok: true, id: r.id, ref, vencimento, comPartida: Boolean(r.journalId) };
}

/** O título que já paga esta obrigação, se existir — para a tela não repetir. */
export async function tituloExistente(
  clientId: string, tipo: TipoDeImposto, de: string, ate: string
): Promise<{ id: string; ref: string; dueDate: string | null } | null> {
  const sb = getServerSupabase();
  const kind = tipo === "vat" ? "VAT3" : "CT1";
  const { data: obrig } = await sb.from("obligations")
    .select("period_label").eq("client_id", clientId).eq("kind", kind)
    .lte("period_start", ate).gte("period_end", de)
    .order("due_date", { ascending: true }).limit(1).maybeSingle();

  const ref = referencia(tipo, (obrig as any)?.period_label ?? null, de, ate);
  const { data } = await sb.from("ledger_items")
    .select("id,document_ref,due_date")
    .eq("client_id", clientId).eq("kind", "payable").eq("document_ref", ref).maybeSingle();

  return data ? { id: (data as any).id, ref, dueDate: (data as any).due_date ?? null } : null;
}
