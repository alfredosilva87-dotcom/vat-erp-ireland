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

/**
 * CÁLCULO POR DENTRO: o cliente diz o que paga, e o sistema acha o líquido.
 *
 * ---------------------------------------------------------------------------
 * A PERGUNTA AO CONTRÁRIO
 *
 * O caminho normal é de baixo para cima: escreve-se o preço sem IVA, o sistema
 * soma o imposto, e sai o total. Mas o preço combinado com um cliente é quase
 * sempre o de CIMA — "são 2.800 e pronto". A fatura tem de mostrar 2.800 no
 * total, e o líquido é o que se descobre a partir dele.
 *
 * Fazer isto à mão é onde se erra: quem tira 23% de 2.800 chega a 2.156,00,
 * que está errado — o IVA incide sobre o líquido, não sobre o bruto. O certo é
 * dividir por 1,23, o que dá 2.276,42 e um IVA de 523,58.
 * ---------------------------------------------------------------------------
 *
 * Reparte o bruto pelas linhas na PROPORÇÃO que elas já têm, e não em partes
 * iguais: uma fatura com uma linha de 2.000 e outra de 500 tem de continuar com
 * essa relação, senão o documento deixa de descrever o que foi combinado.
 *
 * A quantidade NUNCA muda — ela descreve o que foi entregue. O que se ajusta é
 * sempre o preço unitário.
 */
export function porDentro(
  linhas: LinhaDaInvoice[], brutoDesejado: number
): { linhas: LinhaDaInvoice[]; erro?: string } {
  const alvo = cent(Number(brutoDesejado) || 0);
  if (alvo <= 0) return { linhas, erro: "Escreva o valor total que o cliente vai pagar." };

  const uteis = linhas.filter((l) => l.description?.trim());
  if (!uteis.length) return { linhas, erro: "Escreva ao menos uma linha antes de calcular por dentro." };

  const atual = calcularInvoice(uteis);
  if (atual.gross <= 0) {
    return { linhas, erro: "As linhas estão a zero — não há proporção para repartir. Ponha os valores aproximados primeiro." };
  }

  /*
   * O fator é sobre o BRUTO, e não sobre o líquido.
   *
   * Cada linha pode ter alíquota diferente, e o que tem de bater no fim é a
   * soma dos brutos. Um fator calculado sobre líquidos daria certo só quando
   * todas as linhas têm a mesma taxa — o caso comum, e por isso o erro
   * passaria despercebido até à primeira fatura com 23% e 13,5% juntas.
   */
  const escaladas = uteis.map((l) => ({
    ...l,
    unitPrice: cent((Number(l.unitPrice) || 0) * (alvo / atual.gross)),
  }));

  const exacto = fecharAoCentimo(escaladas, alvo);
  if (exacto) return { linhas: exacto };

  /*
   * Há alvos IMPOSSÍVEIS, e não é defeito.
   *
   * O bruto de uma linha é `líquido + arredondar(líquido × taxa)`, e essa
   * função SALTA: a 23%, passa de 2.799,99 para 2.800,01 sem tocar no 2.800,00.
   * Com uma linha só, um em cada quatro ou cinco alvos não existe.
   *
   * Devolve-se o mais próximo COM AVISO. Calar a diferença faria a fatura dizer
   * 2.800 e somar 2.799,99 — e quem descobre isso é o comprador.
   */
  const alcancado = calcularInvoice(escaladas).gross;
  return {
    linhas: escaladas,
    erro: `Com estas alíquotas o total exacto de ${alvo.toFixed(2)} não existe — `
      + `o mais próximo é ${alcancado.toFixed(2)}. Ficou nesse valor.`,
  };
}

/** O bruto de uma linha a partir do líquido — a função que se inverte. */
const brutoDaLinha = (net: number, taxa: number) => cent(net + cent(net * (taxa / 100)));

/**
 * Acerta o último cêntimo, INVERTENDO em vez de tactear.
 *
 * ---------------------------------------------------------------------------
 * Duas tentativas falharam antes desta, e vale a pena dizer porquê:
 *
 *   1. corrigir de uma vez, dividindo a sobra pela taxa. O IVA é
 *      `arredondar(líquido × taxa)`, então um cêntimo a mais no líquido faz o
 *      bruto subir UM ou DOIS — a correcção erra tanto quanto o erro que devia
 *      apagar;
 *   2. tactear cêntimo a cêntimo aceitando só o que melhora. Empata: de −0,01
 *      um salto de dois leva a +0,01, que não é melhor e é recusado, e a busca
 *      fica a um cêntimo do alvo para sempre.
 *
 * O que funciona é inverter: fixa-se tudo menos uma linha, vê-se quanto falta,
 * e procura-se o líquido que dá exactamente esse bruto. E como o resto pode ser
 * inalcançável para essa linha, experimenta-se também deslocar as OUTRAS uns
 * cêntimos — foi o caso que apanhou a versão anterior, com uma linha de
 * quantidade 3 e outra de 1.
 * ---------------------------------------------------------------------------
 */
function fecharAoCentimo(
  base: LinhaDaInvoice[], alvo: number
): LinhaDaInvoice[] | null {
  /*
   * A linha de acerto tem de ter QUANTIDADE 1.
   *
   * O líquido dela tem de poder ser qualquer valor de dois decimais; com
   * quantidade 3, só pode ser múltiplo de três cêntimos, e dois terços dos
   * alvos ficariam fora de alcance. Entre as de quantidade 1, a de maior valor
   * — é onde um cêntimo se nota menos.
   */
  const calc = calcularInvoice(base);
  let acerto = -1, maior = -1;
  base.forEach((l, i) => {
    if ((Number(l.quantity) || 0) !== 1) return;
    if ((calc.linhas[i]?.gross ?? 0) > maior) { maior = calc.linhas[i].gross; acerto = i; }
  });
  if (acerto < 0) return null;

  const taxa = Number(base[acerto].vatRate) || 0;

  /** Dado o bruto que a linha de acerto tem de valer, acha o líquido. */
  const liquidoPara = (bruto: number): number | null => {
    if (bruto <= 0) return null;
    const teorico = cent(bruto / (1 + taxa / 100));
    for (let d = 0; d <= 6; d++) {
      for (const sinal of d === 0 ? [0] : [1, -1]) {
        const net = cent(teorico + sinal * d * 0.01);
        if (net >= 0 && brutoDaLinha(net, taxa) === bruto) return net;
      }
    }
    return null;
  };

  /*
   * As outras linhas deslocam-se até três cêntimos.
   *
   * Sem isto, um resto inalcançável para a linha de acerto dava o alvo por
   * impossível — e muitas vezes bastava mexer um cêntimo noutra linha para o
   * resto passar a ser alcançável. Três cêntimos chegam na prática e mantêm a
   * busca pequena; o desvio é invisível ao lado da própria escala.
   */
  const outras = base.map((_, i) => i).filter((i) => i !== acerto);
  const desvios = [0, 0.01, -0.01, 0.02, -0.02, 0.03, -0.03];

  for (const i of [-1, ...outras]) {
    for (const desvio of i === -1 ? [0] : desvios) {
      const tentativa = base.map((l, k) =>
        k === i ? { ...l, unitPrice: cent((Number(l.unitPrice) || 0) + desvio) } : { ...l });

      const c = calcularInvoice(tentativa);
      const brutoDasOutras = cent(
        c.linhas.reduce((t, l, k) => (k === acerto ? t : t + l.gross), 0)
      );
      const net = liquidoPara(cent(alvo - brutoDasOutras));
      if (net === null) continue;

      tentativa[acerto] = { ...tentativa[acerto], unitPrice: net };
      if (calcularInvoice(tentativa).gross === alvo) return tentativa;
    }
  }
  return null;
}
