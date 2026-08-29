/**
 * A forma jurídica do cliente, e o que decorre dela.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É UM MÓDULO E NÃO UM CAMPO
 *
 * `clients.legal_form` sozinho é só texto. O que interessa é o que ele decide:
 * que declarações o escritório tem de entregar por este cliente, e a partir de
 * que faturamento ele é obrigado a registar-se para VAT.
 *
 * Sem isto, o calendário mostraria CT1 a um empresário em nome individual — e
 * um alerta que não se aplica é pior do que alerta nenhum, porque ensina a
 * fechar o aviso sem ler.
 * ---------------------------------------------------------------------------
 *
 * Sem rede e sem banco: entra a forma jurídica, sai a lista. É por isso que se
 * testa cada regra sozinha, com a lei na mão.
 *
 * **Os números aqui são os limiares irlandeses e mudam por orçamento.** Estão
 * no código de propósito, por agora: são poucos, mudam uma vez por ano, e uma
 * tabela editável sem ninguém que a mantenha envelhece pior do que uma
 * constante que quebra o teste quando muda. Se o escritório quiser mantê-los,
 * a mudança é mover `LIMIARES_VAT` para uma tabela — o resto do módulo não
 * muda.
 */

export type FormaJuridica = "sole_trader" | "limited_company";

export const FORMAS: { valor: FormaJuridica; rotulo: string; curto: string }[] = [
  { valor: "sole_trader", rotulo: "Empresário em nome individual", curto: "Sole trader" },
  { valor: "limited_company", rotulo: "Sociedade por quotas", curto: "Limited company" },
];

/**
 * Os limiares de registo obrigatório de VAT na Irlanda.
 *
 * São DOIS, e a diferença entre eles é a que mais confunde: quem vende BENS
 * tem o dobro do limiar de quem presta SERVIÇOS. Um negócio misto usa o de
 * serviços quando os serviços passam de 10% do total — e é por isso que a
 * decisão não se automatiza aqui: fica o aviso, e quem decide é o contabilista.
 *
 * Válidos a partir de 2025 (Finance Act 2024). Rever a cada orçamento.
 */
export const LIMIARES_VAT = {
  bens: 85_000,
  servicos: 42_500,
  /** Ano a que estes valores dizem respeito — para a tela poder dizê-lo. */
  vigenteDesde: 2025,
} as const;

export type TipoDeObrigacao =
  | "VAT3" | "RTD"          // VAT: apuração periódica e resumo anual
  | "FORM11"                // income tax do empresário em nome individual
  | "CT1"                   // corporation tax da sociedade
  | "B1"                    // contas anuais no CRO
  | "PRELIMINARY_TAX";

export type ObrigacaoDaForma = {
  tipo: TipoDeObrigacao;
  rotulo: string;
  /** Uma frase que diz o que é, para quem não vive nisto todos os dias. */
  oQueE: string;
  /** Só se aplica quando o cliente está registado para VAT. */
  soComVat?: boolean;
};

const VAT: ObrigacaoDaForma[] = [
  { tipo: "VAT3", rotulo: "VAT3", soComVat: true,
    oQueE: "Apuração periódica do IVA — o que se deve à Revenue ou se tem a recuperar." },
  { tipo: "RTD", rotulo: "Return of Trading Details", soComVat: true,
    oQueE: "Resumo anual das vendas e compras por alíquota. Não gera pagamento, mas a falta bloqueia reembolsos." },
];

/**
 * O que este cliente tem de entregar.
 *
 * Forma jurídica por preencher devolve LISTA VAZIA, e não uma lista provável.
 * Adivinhar aqui seria o pior dos dois mundos: o escritório veria uma agenda
 * que parece completa e estaria a cobrar a declaração errada.
 */
export function obrigacoesDa(
  forma: FormaJuridica | null | undefined,
  registadoParaVat: boolean
): ObrigacaoDaForma[] {
  if (!forma) return [];

  const doVat = registadoParaVat ? VAT : [];

  if (forma === "sole_trader") {
    return [
      ...doVat,
      { tipo: "FORM11", rotulo: "Form 11",
        oQueE: "Declaração anual de rendimentos do empresário. Inclui o lucro do negócio e o resto dos rendimentos dele." },
      { tipo: "PRELIMINARY_TAX", rotulo: "Preliminary tax",
        oQueE: "Pagamento por conta do imposto do próprio ano, na mesma data da Form 11." },
    ];
  }

  return [
    ...doVat,
    { tipo: "CT1", rotulo: "CT1",
      oQueE: "Declaração de imposto sobre o lucro da sociedade, nove meses após o fecho do exercício." },
    { tipo: "B1", rotulo: "Annual Return (B1)",
      oQueE: "Contas anuais entregues ao CRO. O atraso tem coima e faz perder a isenção de auditoria." },
  ];
}

export type AvisoDeLimiar = {
  /** Quanto o cliente faturou no período olhado. */
  faturamento: number;
  limiarBens: number;
  limiarServicos: number;
  /** Percentagem do limiar de SERVIÇOS já usada — é o mais apertado dos dois. */
  usoDoMenorLimiar: number;
  estado: "ok" | "aproxima" | "passou";
  /**
   * QUAL dos casos, para a tela poder escrever a frase na língua de quem lê.
   *
   * `estado` não chega: os dois "passou" pedem conversas diferentes — passar os
   * dois limiares não deixa dúvida nenhuma, passar só o de serviços depende de
   * a atividade ser prestação de serviços, e quem decide isso é o contabilista.
   *
   * `mensagem` continua a existir para quem consome a API fora da tela, mas é
   * texto fixo em português: uma tela traduzida nunca a deve mostrar.
   */
  motivo: "abaixo" | "aproxima" | "passouServicos" | "passouAmbos";
  mensagem: string;
};

/**
 * O cliente está perto do limiar de registo de VAT?
 *
 * Este é o único item desta frente que não é lembrete de prazo: é vigilância
 * contínua, e falhar tem custo real — quem passa o limiar e não se regista deve
 * o IVA das vendas que fez sem o cobrar, e paga-o do próprio bolso.
 *
 * Olha-se sempre o limiar MAIS APERTADO dos dois. Sem saber se o faturamento é
 * de bens ou de serviços — e um negócio misto é comum — avisar cedo de mais
 * custa uma conversa; avisar tarde custa dinheiro ao cliente.
 */
export function avisoDeLimiarVat(
  faturamento12Meses: number,
  jaRegistado: boolean
): AvisoDeLimiar | null {
  if (jaRegistado) return null;

  const f = Math.max(0, Number(faturamento12Meses) || 0);
  const uso = LIMIARES_VAT.servicos > 0 ? f / LIMIARES_VAT.servicos : 0;

  const base = {
    faturamento: Math.round(f * 100) / 100,
    limiarBens: LIMIARES_VAT.bens,
    limiarServicos: LIMIARES_VAT.servicos,
    usoDoMenorLimiar: Math.round(uso * 100),
  };

  if (f >= LIMIARES_VAT.bens) {
    return { ...base, estado: "passou", motivo: "passouAmbos",
      mensagem: `Passou os dois limiares (€${LIMIARES_VAT.bens.toLocaleString("en-IE")} em bens, `
        + `€${LIMIARES_VAT.servicos.toLocaleString("en-IE")} em serviços). O registo para VAT é obrigatório.` };
  }
  if (f >= LIMIARES_VAT.servicos) {
    return { ...base, estado: "passou", motivo: "passouServicos",
      mensagem: `Passou o limiar de SERVIÇOS (€${LIMIARES_VAT.servicos.toLocaleString("en-IE")}). `
        + "Se a atividade é prestação de serviços, o registo para VAT já é obrigatório." };
  }
  // 80% é onde ainda dá tempo de tratar do registo antes de faturar a mais.
  if (uso >= 0.8) {
    return { ...base, estado: "aproxima", motivo: "aproxima",
      mensagem: `Já usou ${base.usoDoMenorLimiar}% do limiar de serviços. `
        + "Convém decidir o registo antes de o ultrapassar — depois, o IVA das vendas feitas sem o cobrar sai do bolso do cliente." };
  }
  return { ...base, estado: "ok", motivo: "abaixo",
    mensagem: `${base.usoDoMenorLimiar}% do limiar de serviços. Sem obrigação de registo por faturamento.` };
}
