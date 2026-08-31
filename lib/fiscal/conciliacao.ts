/**
 * A CONCILIAÇÃO FISCAL: o imposto dos documentos contra o imposto do razão.
 *
 * ---------------------------------------------------------------------------
 * A PERGUNTA QUE NINGUÉM ESTAVA A FAZER
 *
 * O sistema apura o VAT por duas vias que nunca se olharam:
 *
 *   1. pelos DOCUMENTOS — soma o IVA das notas de compra e das vendas do
 *      período. É daqui que sai o VAT3 que vai para a Revenue;
 *   2. pelo RAZÃO — o movimento das contas de controlo de IVA, que nasce da
 *      contabilização desses mesmos documentos.
 *
 * Se a contabilização estivesse sempre certa, as duas dariam o mesmo número
 * sempre. Não estão: um documento pode entrar no período e não ser
 * contabilizado, ser contabilizado com outro valor, ou ser lançado à mão no
 * razão sem documento nenhum. Nenhuma dessas três dá erro em lado nenhum.
 *
 * A diferença entre as duas vias é o **único sítio onde isso aparece**. Zero
 * quer dizer que a declaração e os livros contam a mesma história; qualquer
 * outra coisa é uma delas a mentir, e é preciso saber qual antes de entregar.
 * ---------------------------------------------------------------------------
 *
 * Sem rede e sem banco: entram os dois lados, sai a diferença. É por isso que
 * se testa cada caso com os números na mão.
 */

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Uma linha de confronto: o que o documento diz, o que o razão diz, e a falta.
 *
 * A diferença é sempre **documentos − razão**, nesta ordem e em todas as
 * linhas. Trocar o sinal numa delas faria duas linhas com o mesmo problema
 * apontarem para lados opostos, e ninguém confia num quadro assim.
 */
export type LinhaDeConfronto = {
  /*
   * A CHAVE de tradução, e não o texto.
   *
   * Este módulo corre no servidor, e `useT` é um hook que só existe no
   * navegador. Devolver o rótulo escrito fazia a tela mostrar português no meio
   * de uma interface em inglês — e viu-se logo na primeira vez que se abriu.
   *
   * Com a chave, quem escolhe a língua é quem a sabe: o ecrã.
   */
  chave: "vatOut" | "vatIn" | "taxRecognised";
  /** Apurado pelos DOCUMENTOS — o que vai na declaração. */
  documentos: number;
  /** Apurado pelo RAZÃO — o movimento das contas do período. */
  razao: number;
  diferenca: number;
  /** As contas do razão que entram nesta linha, para quem quiser ir ver. */
  contas: string[];
};

/**
 * Um cêntimo de diferença ainda é diferença.
 *
 * Não há tolerância. Foi uma decisão: qualquer folga que se dê aqui esconde
 * exactamente o tipo de erro que isto existe para achar — um documento com o
 * IVA arredondado de forma diferente na contabilização. E como os dois lados
 * saem do mesmo documento, zero é alcançável.
 */
export const TOLERANCIA = 0;

export function confrontar(
  chave: LinhaDeConfronto["chave"], documentos: number, razao: number, contas: string[]
): LinhaDeConfronto {
  return {
    chave, contas,
    documentos: r2(documentos),
    razao: r2(razao),
    diferenca: r2(documentos - razao),
  };
}

export type EstadoDaConciliacao = "fecha" | "diverge" | "sem_movimento";

export function estadoDe(linhas: LinhaDeConfronto[]): EstadoDaConciliacao {
  const houve = linhas.some((l) => l.documentos !== 0 || l.razao !== 0);
  if (!houve) return "sem_movimento";
  return linhas.some((l) => Math.abs(l.diferenca) > TOLERANCIA) ? "diverge" : "fecha";
}

// ------------------------------------------------------------------- VAT

export type ApuracaoDeVat = {
  /** IVA das VENDAS do período — o que se deve. */
  saidas: number;
  /** IVA das COMPRAS com direito a crédito — o que se recupera. */
  entradas: number;
  /** A pagar (positivo) ou a recuperar (negativo). */
  aPagar: number;
};

/**
 * O VAT3 do período, pelos documentos.
 *
 * `entradas` é o IVA **com direito a crédito**, e não o IVA das compras todas:
 * uma refeição ou um carro de passageiros trazem IVA que não se recupera, e
 * somá-lo aqui inflaria o crédito e a declaração sairia errada a favor do
 * cliente — que é o lado que a Revenue verifica primeiro.
 */
export function apuracao(saidas: number, entradasComCredito: number): ApuracaoDeVat {
  return {
    saidas: r2(saidas),
    entradas: r2(entradasComCredito),
    aPagar: r2(saidas - entradasComCredito),
  };
}

export type ConciliacaoDeVat = {
  de: string;
  ate: string;
  apuracao: ApuracaoDeVat;
  linhas: LinhaDeConfronto[];
  estado: EstadoDaConciliacao;
  /** O total das diferenças, para o cabeçalho. */
  diferencaTotal: number;
};

/**
 * Monta o quadro do VAT.
 *
 * `razaoSaidas` é o movimento CREDOR da conta de IVA a pagar no período, e
 * `razaoEntradas` o movimento DEVEDOR da conta de IVA a recuperar. São
 * movimentos e não saldos: o saldo arrasta o que ficou de períodos anteriores,
 * e a declaração é só do período — comparar saldo com movimento daria uma
 * diferença que existe e não é erro nenhum.
 */
export function conciliarVat(args: {
  de: string; ate: string;
  docSaidas: number; docEntradas: number;
  razaoSaidas: number; razaoEntradas: number;
  contaSaidas: string; contaEntradas: string;
}): ConciliacaoDeVat {
  const linhas = [
    confrontar("vatOut", args.docSaidas, args.razaoSaidas, [args.contaSaidas]),
    confrontar("vatIn", args.docEntradas, args.razaoEntradas, [args.contaEntradas]),
  ];
  const estado = estadoDe(linhas);
  return {
    de: args.de, ate: args.ate,
    apuracao: apuracao(args.docSaidas, args.docEntradas),
    linhas, estado,
    diferencaTotal: r2(linhas.reduce((s, l) => s + Math.abs(l.diferenca), 0)),
  };
}

// ------------------------------------------------------- imposto sobre lucro

export type ConciliacaoDeImposto = {
  de: string;
  ate: string;
  /** Lucro antes de imposto, do próprio DRE. */
  lucroAntesDeImposto: number;
  /** A despesa de imposto lançada no período. */
  despesaDeImposto: number;
  /** Lucro depois de imposto. */
  lucroDepois: number;
  /** A alíquota que os números implicam — não a da lei. */
  taxaEfetiva: number | null;
  linhas: LinhaDeConfronto[];
  estado: EstadoDaConciliacao;
  /** Sole trader não paga corporation tax; a tela tem de o dizer. */
  aplicavel: boolean;
  diferencaTotal: number;
};

/** As alíquotas irlandesas de corporation tax, para o quadro poder comparar. */
export const CT_TRADING = 12.5;
export const CT_NAO_TRADING = 25;

/**
 * O quadro do imposto sobre o lucro.
 *
 * O confronto aqui é outro: a DESPESA de imposto lançada no resultado contra o
 * que foi mexido no passivo de imposto. Reconhecer a despesa sem reconhecer a
 * dívida (ou o pagamento) é o erro clássico de fecho — o lucro depois de
 * imposto sai certo e o balanço fica a dever a diferença.
 *
 * A taxa EFETIVA sai dos números e não da lei. É ela que denuncia o que uma
 * comparação com os 12,5% não denuncia: uma despesa lançada a mais, ou um
 * lucro que mudou depois de o imposto ter sido calculado.
 */
export function conciliarImposto(args: {
  de: string; ate: string;
  aplicavel: boolean;
  lucroAntesDeImposto: number;
  despesaDeImposto: number;
  movimentoDoPassivo: number;
  contaDespesa: string; contaPassivo: string;
}): ConciliacaoDeImposto {
  const lucro = r2(args.lucroAntesDeImposto);
  const despesa = r2(args.despesaDeImposto);

  const linhas = [
    confrontar("taxRecognised", despesa, args.movimentoDoPassivo,
      [args.contaDespesa, args.contaPassivo]),
  ];

  return {
    de: args.de, ate: args.ate,
    aplicavel: args.aplicavel,
    lucroAntesDeImposto: lucro,
    despesaDeImposto: despesa,
    lucroDepois: r2(lucro - despesa),
    // Sem lucro não há taxa — e uma divisão por zero mostrada como "0%" ou
    // "Infinity%" no ecrã é pior do que um traço.
    taxaEfetiva: lucro > 0 ? r2((despesa / lucro) * 100) : null,
    linhas,
    estado: estadoDe(linhas),
    diferencaTotal: r2(Math.abs(linhas[0].diferenca)),
  };
}
