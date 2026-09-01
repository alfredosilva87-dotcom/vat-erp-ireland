import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { criarTituloManual } from "@/lib/accounting/service";
import { CONTAS_PADRAO } from "@/lib/accounting/post";
import { periodoTravado } from "@/lib/accounting/periodos";

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
 *             O razão só se mexe na BAIXA — DR imposto a pagar / CR banco —,
 *             que é o lançamento que faltava e o que fecha a conta de controlo.
 *
 *   Imposto — a dívida pode ou não existir já, e só o escritório sabe qual dos
 *   sobre     dois casos é o seu. Por isso aqui é ESCOLHA, e não regra:
 *   o lucro
 *             com conta de despesa → o título traz o lançamento de fecho
 *                                    (DR a conta escolhida / CR o passivo),
 *                                    para quem ainda não o fez;
 *             sem conta            → o título nasce sem partida, como o de IVA,
 *                                    para quem já lançou o imposto no fecho —
 *                                    lançá-lo de novo dobrava a despesa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AS CONTAS SÃO ESCOLHIDAS E NÃO FIXAS
 *
 * Estavam escritas no código: 845 para o IVA, 501/831 para o imposto sobre o
 * lucro. Funcionam para o plano da prática, e só para ele — o próprio plano
 * tem 836 (RCT), 844 (retenção na fonte) e uma 849 que existe exactamente para
 * o imposto que ele não previu. Um número escrito no código só se muda com um
 * deploy, e é a mesma razão que fez os tipos de encargo virarem tabela.
 * ---------------------------------------------------------------------------
 */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** O que se propõe quando ninguém escolhe — as mesmas contas da conciliação. */
export const CONTAS_SUGERIDAS = {
  vat: CONTAS_PADRAO.vatPayable,
  impostoPassivo: "831",
  impostoDespesa: "501",
} as const;

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
  /** A conta do imposto A PAGAR — a que a baixa vai debitar. */
  contaDoImposto?: string | null;
  /**
   * Só no imposto sobre o lucro: a conta onde a DESPESA é reconhecida.
   * Vazia significa "já lançado no fecho" — e aí o título nasce sem partida.
   */
  contaDeDespesa?: string | null;
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
export function referencia(tipo: TipoDeImposto, periodo: string | null, de: string, ate: string): string {
  const rotulo = periodo?.trim() || `${de} a ${ate}`;
  return tipo === "vat" ? `VAT3 ${rotulo}` : `CT1 ${rotulo}`;
}

export async function criarTituloDeImposto(p: PedidoDeTitulo): Promise<ResultadoDoTitulo> {
  const valor = r2(Math.abs(p.valor));
  if (valor <= 0) {
    return { ok: false, erro: "Não há imposto a pagar neste período — o apurado é zero ou a recuperar." };
  }

  /*
   * O TÍTULO SÓ NASCE DEPOIS DO MÊS FECHADO.
   *
   * Pedido do Alfredo: "após mês fechado gera". A razão é que o apurado muda
   * enquanto o período está aberto — uma nota que entra depois muda o IVA a
   * pagar —, e um título com o valor de ontem seria pago com o valor de ontem.
   * O fecho é o que faz do número um facto, e é só a partir daí que faz
   * sentido pô-lo em contas a pagar.
   *
   * A mensagem diz QUAL mês falta, e não que "o período está aberto": quem
   * carregou no botão está a tentar fazer uma coisa, e precisa do passo
   * seguinte, não do diagnóstico.
   */
  const trava = await periodoTravado(p.clientId, p.de, p.ate);
  if (!trava.fechado) {
    return {
      ok: false,
      erro: `Falta fechar ${trava.primeiroAberto}. O imposto só vira título depois de o período estar fechado — `
        + "enquanto está aberto, o apurado ainda muda.",
    };
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
  /*
   * `limit(1)` e não `maybeSingle()`.
   *
   * `document_ref` não tem — nem pode ter — índice único: a referência de um
   * título de compra vem do número da nota do fornecedor, e dois fornecedores
   * diferentes emitem notas com o mesmo número todos os dias.
   *
   * `maybeSingle` REBENTA ao encontrar duas linhas. Se alguma vez existirem
   * duas com esta referência, esta função — que existe justamente para impedir
   * a segunda — passaria a falhar para sempre, e a falhar sem dizer porquê. A
   * pergunta aqui é "já existe algum?", e para isso um chega.
   */
  const { data: existentes } = await sb.from("ledger_items")
    .select("id").eq("client_id", p.clientId).eq("kind", "payable")
    .eq("document_ref", ref).limit(1);
  if (existentes?.length) {
    return { ok: false, erro: `Já existe um título para ${ref}. Veja em contas a pagar.` };
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const contaDoImposto = (p.contaDoImposto ?? "").trim()
    || (p.tipo === "vat" ? CONTAS_SUGERIDAS.vat : CONTAS_SUGERIDAS.impostoPassivo);

  /*
   * O IVA nunca traz partida, e o imposto sobre o lucro só traz se lhe derem a
   * conta da despesa. Ver o bloco no topo: no IVA a dívida já está no razão,
   * no imposto sobre o lucro depende de o fecho já ter sido lançado ou não.
   */
  const contaDeDespesa = p.tipo === "vat" ? "" : (p.contaDeDespesa ?? "").trim();
  const comPartida = Boolean(contaDeDespesa);

  const r = await criarTituloManual({
    clientId: p.clientId, kind: "payable",
    counterparty: "Revenue",
    documentRef: ref,
    issueDate: hoje, dueDate: vencimento,
    amount: valor,
    tipo: comPartida ? "normal" : "imposto",
    resultAccount: comPartida ? contaDeDespesa : null,
    controlAccount: contaDoImposto,
    notes: p.tipo === "vat"
      ? "Apuração de IVA do período. A dívida já está na conta de controlo — "
        + "este título é a vista de contas a pagar dela, e o razão só se mexe na baixa."
      : comPartida
        ? "Imposto sobre o lucro do exercício, reconhecido com este título."
        : "Imposto sobre o lucro já reconhecido no fecho — este título é só a "
          + "vista de contas a pagar dele.",
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
  // Mesma razão de `criarTituloDeImposto`: `document_ref` não é único, e
  // `maybeSingle` rebentaria ao achar duas.
  const { data } = await sb.from("ledger_items")
    .select("id,document_ref,due_date")
    .eq("client_id", clientId).eq("kind", "payable").eq("document_ref", ref).limit(1);

  const t = (data ?? [])[0] as any;
  return t ? { id: t.id, ref, dueDate: t.due_date ?? null } : null;
}
