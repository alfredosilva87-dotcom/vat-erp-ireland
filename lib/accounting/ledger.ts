import "server-only";
import { getServerSupabase } from "@/lib/supabase";

/**
 * O RAZÃO: os lançamentos conta a conta, com saldo anterior e saldo corrido.
 *
 * É a peça que faltava. Balancete, DRE e balanço dizem QUANTO; o razão é onde
 * se concilia — abre-se a conta, corre-se o olho pelas linhas e vê-se onde o
 * saldo deixou de bater. Por isso duas coisas são obrigatórias aqui e não
 * seriam num relatório de fecho:
 *
 * 1. **Saldo anterior.** Um razão que começa do zero na data escolhida não se
 *    concilia com nada: o saldo final não fecha com o extrato nem com o
 *    balancete, e quem confere passa a tarde a procurar uma diferença que é a
 *    própria janela. O saldo anterior é a soma de TUDO antes de `de`.
 *
 * 2. **Recorte por data, e não por exercício.** Concilia-se um mês, uma
 *    quinzena, a semana em que o extrato do banco chegou. Obrigar o ano
 *    inteiro põe dez mil linhas no ecrã para ler trinta.
 *
 * A mesma função serve a tela, o PDF e o Excel — como em `query.ts`, e pelo
 * mesmo motivo: o papel entregue não pode discordar do que a pessoa viu.
 */

const PAGINA = 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Contas de natureza devedora: o saldo é débito menos crédito. */
const DEVEDORA = ["asset", "expense"];
const naturezaDe = (tipo: string | null): "debit" | "credit" =>
  DEVEDORA.includes(String(tipo)) ? "debit" : "credit";

export type LancamentoDoRazao = {
  id: string;
  /** Data contábil — a que ordena o razão. */
  date: string;
  /** Data do documento. Diferente da contábil num recibo sem data. */
  entryDate: string;
  sourceModule: string;
  documentId: string | null;
  documentRef: string | null;
  journalId: string;
  counterparty: string | null;
  description: string | null;
  /** Qual elo da cadeia escolheu esta conta. */
  resolvedBy: string | null;
  debit: number;
  credit: number;
  /** Saldo corrido depois desta linha, na natureza da conta. */
  balance: number;
};

export type ContaDoRazao = {
  code: string;
  name: string;
  type: string | null;
  reportGroup: string | null;
  side: "debit" | "credit";
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  entries: LancamentoDoRazao[];
};

export type Razao = {
  from: string;
  to: string;
  client: { name: string; client_code: string | null; vat_number: string | null; cro: string | null } | null;
  /** As contas pedidas (ou todas com movimento), já montadas. */
  accounts: ContaDoRazao[];
  /**
   * Todas as contas que têm o que mostrar no período, mesmo as não escolhidas.
   *
   * É o que enche o seletor da tela. Sai da mesma leitura: pedir de novo só
   * para listar as opções duplicaria a consulta mais cara desta tela.
   */
  available: { code: string; name: string; entries: number; movement: number }[];
  totals: { opening: number; debit: number; credit: number; closing: number };
};

/**
 * Os cabeçalhos de lançamento do cliente, até à data final.
 *
 * Paginado, e não é zelo excessivo: o PostgREST devolve no máximo 1000 linhas
 * e **não avisa quando corta**. Já custou um balanço errado em silêncio neste
 * módulo — ver o comentário em `query.ts`. Um razão truncado é pior ainda,
 * porque o saldo corrido continua a somar e parece certo até ao fim.
 */
async function cabecalhos(clientId: string, ate: string) {
  const sb = getServerSupabase();
  const todos: any[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await sb.from("journal")
      .select("id,entry_date,posting_date,source_module,document_id,document_ref,description")
      .eq("client_id", clientId)
      .lte("posting_date", ate)
      .order("posting_date", { ascending: true })
      .order("id", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as any[];
    todos.push(...lote);
    if (lote.length < PAGINA) return todos;
  }
}

/** As partidas desses lançamentos, em lotes de ids. */
async function partidas(journalIds: string[]) {
  const sb = getServerSupabase();
  const todas: any[] = [];
  // Lotes de ids, e paginação dentro de cada lote: um lote de 200 cabeçalhos
  // pode render mais de 1000 partidas por si só.
  const LOTE = 200;
  for (let i = 0; i < journalIds.length; i += LOTE) {
    const ids = journalIds.slice(i, i + LOTE);
    for (let inicio = 0; ; inicio += PAGINA) {
      const { data, error } = await sb.from("journal_lines")
        .select("id,journal_id,line_no,account_code,debit,credit,description,resolved_by,counterparty")
        .in("journal_id", ids)
        .order("journal_id", { ascending: true })
        .order("line_no", { ascending: true })
        .range(inicio, inicio + PAGINA - 1);
      if (error) throw new Error(error.message);
      const lote = (data ?? []) as any[];
      todas.push(...lote);
      if (lote.length < PAGINA) break;
    }
  }
  return todas;
}

export async function loadLedger(
  clientId: string, de: string, ate: string, contas?: string[] | null
): Promise<Razao> {
  const sb = getServerSupabase();

  const [{ data: cliente }, { data: plano }, cabs] = await Promise.all([
    sb.from("clients").select("name,client_code,vat_number,cro").eq("id", clientId).maybeSingle(),
    sb.from("chart_of_accounts").select("code,description,type,report_group"),
    cabecalhos(clientId, ate),
  ]);

  const porId = new Map<string, any>(cabs.map((c) => [c.id, c]));
  const linhas = cabs.length ? await partidas(cabs.map((c) => c.id)) : [];

  const info = new Map<string, any>(
    ((plano ?? []) as any[]).filter((c) => c.type).map((c) => [c.code, c])
  );

  /*
   * Uma passagem só, e o corte por data acontece aqui dentro.
   *
   * Antes de `de` a linha alimenta o SALDO ANTERIOR; dentro da janela vira
   * lançamento visível. Fazer duas consultas (uma para o saldo, outra para o
   * movimento) leria o mesmo razão duas vezes e abriria a porta a que as duas
   * discordassem por um lançamento gravado no meio.
   */
  const contasMap = new Map<string, ContaDoRazao>();
  const daConta = (codigo: string): ContaDoRazao => {
    const atual = contasMap.get(codigo);
    if (atual) return atual;
    const meta = info.get(codigo);
    const novo: ContaDoRazao = {
      code: codigo,
      name: meta?.description ?? codigo,
      type: meta?.type ?? null,
      reportGroup: meta?.report_group ?? null,
      side: naturezaDe(meta?.type ?? null),
      opening: 0, debit: 0, credit: 0, closing: 0, entries: [],
    };
    contasMap.set(codigo, novo);
    return novo;
  };

  for (const l of linhas) {
    const cab = porId.get(l.journal_id);
    if (!cab) continue;
    const conta = daConta(l.account_code);
    const debito = Number(l.debit) || 0;
    const credito = Number(l.credit) || 0;
    const efeito = conta.side === "debit" ? debito - credito : credito - debito;

    if (cab.posting_date < de) {
      conta.opening = r2(conta.opening + efeito);
      continue;
    }
    conta.debit = r2(conta.debit + debito);
    conta.credit = r2(conta.credit + credito);
    conta.entries.push({
      id: l.id,
      date: cab.posting_date,
      entryDate: cab.entry_date,
      sourceModule: cab.source_module,
      documentId: cab.document_id,
      documentRef: cab.document_ref,
      journalId: cab.id,
      counterparty: l.counterparty ?? cab.description ?? null,
      description: l.description ?? cab.description ?? null,
      resolvedBy: l.resolved_by ?? null,
      debit: debito, credit: credito,
      balance: 0, // preenchido a seguir, quando a ordem estiver fixada
    });
  }

  for (const conta of contasMap.values()) {
    /*
     * A ordem do razão é a DATA CONTÁBIL, e o desempate é o documento.
     *
     * Sem desempate estável, dois lançamentos do mesmo dia trocavam de lugar
     * entre duas aberturas do ecrã, e o saldo corrido ao lado deles mudava com
     * eles — o que faz qualquer pessoa duvidar do relatório, com razão.
     */
    conta.entries.sort((a, b) =>
      a.date.localeCompare(b.date) ||
      String(a.documentRef ?? "").localeCompare(String(b.documentRef ?? "")) ||
      a.id.localeCompare(b.id)
    );
    let corrido = conta.opening;
    for (const e of conta.entries) {
      corrido = r2(corrido + (conta.side === "debit" ? e.debit - e.credit : e.credit - e.debit));
      e.balance = corrido;
    }
    conta.closing = corrido;
  }

  const todas = Array.from(contasMap.values())
    .filter((c) => c.entries.length > 0 || c.opening !== 0 || c.closing !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  const escolhidas = contas && contas.length
    ? todas.filter((c) => contas.includes(c.code))
    : todas;

  const soma = (f: (c: ContaDoRazao) => number) => r2(escolhidas.reduce((s, c) => s + f(c), 0));

  return {
    from: de, to: ate,
    client: (cliente as any) ?? null,
    accounts: escolhidas,
    available: todas.map((c) => ({
      code: c.code, name: c.name,
      entries: c.entries.length,
      movement: r2(c.debit + c.credit),
    })),
    /*
     * Os totais somam as contas ESCOLHIDAS, e não o razão inteiro.
     *
     * Débito e crédito de uma seleção parcial não fecham entre si, e não devem
     * fechar: cada lançamento tem a contrapartida noutra conta, que pode não
     * estar na seleção. Quem quer a prova de que o razão fecha usa o
     * balancete, que é a peça para isso.
     */
    totals: {
      opening: soma((c) => c.opening),
      debit: soma((c) => c.debit),
      credit: soma((c) => c.credit),
      closing: soma((c) => c.closing),
    },
  };
}

/** O recorte pedido, ou o ano do exercício quando falta. */
export function recorte(sp: URLSearchParams): { de: string; ate: string } {
  const ano = Number(sp.get("year")) || new Date().getFullYear();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const de = sp.get("from");
  const ate = sp.get("to");
  return {
    de: de && iso.test(de) ? de : `${ano}-01-01`,
    ate: ate && iso.test(ate) ? ate : `${ano}-12-31`,
  };
}

/** `accounts=1100,2100` → lista; vazio ou ausente → todas. */
export function contasPedidas(sp: URLSearchParams): string[] | null {
  const cru = sp.get("accounts");
  if (!cru) return null;
  const lista = cru.split(",").map((c) => c.trim()).filter(Boolean);
  return lista.length ? lista : null;
}
