/**
 * As contas de uma invoice: linhas, IVA por alíquota, e o total a pagar.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É UM MÓDULO PURO E TESTADO À PARTE
 *
 * Uma fatura é um documento fiscal que sai da empresa e vai para as mãos de
 * outra. O total que lá está é o que o comprador paga e o que o vendedor
 * declara — e um cêntimo de diferença entre o PDF, a venda gravada e o VAT3 é
 * uma divergência que alguém vai ter de justificar.
 *
 * A armadilha aqui não é a multiplicação, é o ARREDONDAMENTO. Três linhas de
 * €33,333 dão €99,999: arredondar no fim dá €100,00, arredondar linha a linha
 * dá €99,99. Nenhum dos dois está errado em abstrato, mas o sistema tem de
 * escolher UM e usá-lo em todo o lado, senão o PDF e a contabilidade divergem.
 *
 * Escolha: **arredonda-se a cada linha**, e os totais são a soma dos
 * arredondados. É o que faz a fatura fechar quando o comprador soma as linhas
 * com uma calculadora — que é como as faturas são conferidas de facto.
 * ---------------------------------------------------------------------------
 */

export type LinhaDaInvoice = {
  description: string;
  detail?: string | null;
  quantity: number;
  unitPrice: number;
  vatRate: number;
};

export type LinhaCalculada = LinhaDaInvoice & {
  net: number;
  vat: number;
  gross: number;
};

/** Duas casas, com o meio para cima — o arredondamento comercial. */
export const cent = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  // `Math.round(x * 100) / 100` erra em casos como 1.005 por causa da
  // representação binária; o desvio de um épsilon corrige-os sem afetar o resto.
  return Math.round((n + Number.EPSILON * Math.sign(n || 1)) * 100) / 100;
};

export function calcularLinha(l: LinhaDaInvoice): LinhaCalculada {
  const qtd = Number(l.quantity) || 0;
  const preco = Number(l.unitPrice) || 0;
  const taxa = Math.max(0, Number(l.vatRate) || 0);

  const net = cent(qtd * preco);
  const vat = cent(net * (taxa / 100));
  return { ...l, quantity: qtd, unitPrice: preco, vatRate: taxa, net, vat, gross: cent(net + vat) };
}

export type TotalPorTaxa = { rate: number; net: number; vat: number };

export type TotaisDaInvoice = {
  linhas: LinhaCalculada[];
  net: number;
  vat: number;
  gross: number;
  /**
   * O IVA aberto por alíquota.
   *
   * Uma fatura irlandesa com 23% e 13,5% tem de mostrar os dois separados —
   * um total de IVA agregado não deixa o comprador conferir nem o RTD fechar.
   */
  porTaxa: TotalPorTaxa[];
};

export function calcularInvoice(linhas: LinhaDaInvoice[]): TotaisDaInvoice {
  const calculadas = linhas.map(calcularLinha);

  const mapa = new Map<number, TotalPorTaxa>();
  for (const l of calculadas) {
    const g = mapa.get(l.vatRate) ?? { rate: l.vatRate, net: 0, vat: 0 };
    g.net = cent(g.net + l.net);
    g.vat = cent(g.vat + l.vat);
    mapa.set(l.vatRate, g);
  }

  return {
    linhas: calculadas,
    // Somar os JÁ ARREDONDADOS, e não arredondar a soma dos brutos: é isto que
    // faz a fatura fechar quando alguém soma a coluna à mão.
    net: cent(calculadas.reduce((s, l) => s + l.net, 0)),
    vat: cent(calculadas.reduce((s, l) => s + l.vat, 0)),
    gross: cent(calculadas.reduce((s, l) => s + l.gross, 0)),
    porTaxa: [...mapa.values()].sort((a, b) => b.rate - a.rate),
  };
}

/**
 * A data de vencimento a partir dos termos de pagamento.
 *
 * Aceita o que as pessoas escrevem — "30 dias", "30 days", "net 30", "a pronto"
 * — porque o campo é livre e vai continuar a ser: cada negócio tem a sua
 * redação, e obrigar a um menu fechado faz com que se escolha o mais parecido.
 *
 * Sem número reconhecível devolve `null`, e NÃO uma data assumida: uma data de
 * vencimento inventada aparece no painel de contas a receber como se fosse
 * verdade, e alguém cobra o cliente no dia errado.
 */
export function vencimentoDosTermos(emissao: string, termos: string | null | undefined): string | null {
  if (!termos) return null;
  const t = termos.toLowerCase();
  if (/pronto|imediat|on receipt|due on|cash/.test(t)) return emissao;

  const dias = t.match(/(\d{1,3})\s*(d|dia|dias|day|days)?/)?.[1];
  if (!dias) return null;

  const d = new Date(`${emissao}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(dias));
  return d.toISOString().slice(0, 10);
}

export type ProblemaDaInvoice = { campo: string; mensagem: string };

/**
 * O que impede esta invoice de ser EMITIDA.
 *
 * Corre antes de a fatura ganhar número, porque um número gasto não volta atrás:
 * a sequência já avançou, e um buraco nela é o mesmo achado de auditoria que a
 * numeração atómica existe para evitar.
 *
 * Devolve TUDO o que está mal de uma vez. Uma validação que para no primeiro
 * erro obriga a corrigir, gravar, descobrir o seguinte, e assim por diante.
 */
export function problemasParaEmitir(inv: {
  customerName?: string | null;
  issueDate?: string | null;
  linhas: LinhaDaInvoice[];
  vendedorTemVat?: boolean;
  compradorVat?: string | null;
}): ProblemaDaInvoice[] {
  const p: ProblemaDaInvoice[] = [];

  if (!inv.customerName?.trim()) p.push({ campo: "customer", mensagem: "Escolha ou escreva o cliente a quem a fatura é emitida." });
  if (!inv.issueDate) p.push({ campo: "issueDate", mensagem: "A fatura precisa de data de emissão." });

  const uteis = inv.linhas.filter((l) => l.description?.trim());
  if (!uteis.length) {
    p.push({ campo: "items", mensagem: "A fatura precisa de ao menos uma linha com descrição." });
  }

  const totais = calcularInvoice(uteis);
  if (uteis.length && totais.gross <= 0) {
    // Uma fatura de zero passa por todos os caminhos e não cobra nada. Já
    // aconteceu no lado das compras, e o efeito é o mesmo: um documento que
    // parece emitido e não é.
    p.push({ campo: "items", mensagem: "O total da fatura é zero. Confira as quantidades e os preços." });
  }
  if (uteis.some((l) => (Number(l.quantity) || 0) < 0 || (Number(l.unitPrice) || 0) < 0)) {
    p.push({ campo: "items", mensagem: "Há quantidade ou preço negativo. Para devolver valor, emita uma nota de crédito." });
  }

  /*
   * Cobrar IVA sem estar registado é o erro caro do lado da emissão.
   *
   * Um sole trader abaixo do limiar que emita uma fatura com 23% cobrou ao
   * comprador um imposto que não pode entregar — e vai ter de o devolver ou
   * entregá-lo à Revenue sem o ter descontado. Ver lib/fiscal/formaJuridica.ts.
   */
  if (inv.vendedorTemVat === false && uteis.some((l) => (Number(l.vatRate) || 0) > 0)) {
    p.push({
      campo: "vat",
      mensagem: "Este cliente não tem número de VAT registado, e a fatura está a cobrar IVA. "
        + "Ou preenche o número de VAT no cadastro, ou põe as linhas a 0%.",
    });
  }

  return p;
}
