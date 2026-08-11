/**
 * Regra por fornecedor (camada B1).
 *
 * O sistema decide o destino de um item em três níveis, e este arquivo é o do
 * meio:
 *
 *   1. ESCOLHA MANUAL — o que o contador digitou na nota. Manda sempre.
 *   2. REGRA DE FORNECEDOR — aqui.
 *   3. APRENDIDO — `items_master` e `client_item_accounts`, estatística sobre
 *      o que foi feito antes.
 *
 * A ordem não é arbitrária: a regra é uma decisão escrita de propósito, o
 * aprendido é uma média do passado. Deixar a média sobrepor a decisão faria a
 * regra parecer quebrada — o contador escreve, salva, e a nota seguinte chega
 * com outra conta.
 *
 * Duas coisas moldam o desenho:
 *
 *   - **Campo vazio não decide nada.** Uma regra pode dizer só a conta e calar
 *     sobre a alíquota. É assim que um supermercado ganha destino contábil sem
 *     ter as alíquotas das suas linhas achatadas num número só.
 *   - **Ganha o reconhecimento mais forte**, nunca a ordem de cadastro: número
 *     de VAT bate nome, e nome mais longo bate nome mais curto. Uma fila
 *     ordenada à mão (como nas regras de banco, camada A3) não serve aqui,
 *     porque duas regras de fornecedor não competem por um mesmo texto solto —
 *     elas identificam entidades diferentes, e a mais específica é sempre a
 *     resposta certa.
 *
 * Função pura de propósito: identidade e regras entram, decisão sai. Sem banco,
 * para que cada regra abaixo seja testável e um resultado errado reproduzível.
 */

export interface SupplierRule {
  id: string;
  label: string;
  /** Só letras e dígitos, maiúsculas. Ver 007_supplier_rules.sql. */
  supplier_vat: string | null;
  /** Minúsculo e sem acento. */
  name_match: string | null;
  account_code: string | null;
  account_name: string | null;
  /** Código em `vat_categories`. A alíquota vem dela, não é copiada aqui. */
  vat_category_code: string | null;
  extract_line_items: boolean;
  active: boolean;
}

/** O que a leitura do documento sabe sobre quem emitiu. */
export interface SupplierIdentity {
  supplier_name: string | null;
  store_name: string | null;
  supplier_vat: string | null;
}

export type SupplierMatchedBy = "vat" | "name";

export interface SupplierRuleOutcome {
  /** A regra que vale. Nulo quando nenhuma casa ou quando há conflito. */
  rule: SupplierRule | null;
  matchedBy: SupplierMatchedBy | null;
  /**
   * Regras de alcance idêntico que discordam entre si. Enquanto isso durar,
   * NENHUMA é aplicada: aplicar uma no par ou ímpar seria decidir a conta
   * contábil por sorteio, e ninguém saberia que houve sorteio.
   */
  conflict: SupplierRule[];
}

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** "IE 1234567 X" e "ie1234567x" são o mesmo número. */
export const vatKey = (s: unknown): string =>
  String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** O texto guardado num `name_match`, na forma em que é comparado. */
export const nameKey = (s: unknown): string => norm(s);

/**
 * Um padrão de nome curto casa com meio mundo: "co" aparece em "Tesco",
 * "Costa" e "Vodacom". Três caracteres é o mínimo em que o padrão ainda diz
 * algo sobre quem emitiu o documento.
 */
export const MIN_NAME_MATCH = 3;

/** O que a regra decide para uma linha. Nulo em todo campo = não opina. */
export interface RuleDecision {
  account_code: string | null;
  account_name: string | null;
  vat_category_code: string | null;
  extract_line_items: boolean;
}

export function ruleDecision(rule: SupplierRule): RuleDecision {
  return {
    account_code: rule.account_code || null,
    account_name: rule.account_name || null,
    vat_category_code: rule.vat_category_code || null,
    extract_line_items: rule.extract_line_items !== false,
  };
}

/** Uma regra que não decide nada e deixa as linhas ligadas não faz efeito nenhum. */
export function ruleIsEmpty(rule: SupplierRule): boolean {
  const d = ruleDecision(rule);
  return !d.account_code && !d.vat_category_code && d.extract_line_items;
}

/** Duas regras dizem a mesma coisa? Usado para saber se um empate importa. */
function sameDecision(a: SupplierRule, b: SupplierRule): boolean {
  const x = ruleDecision(a);
  const y = ruleDecision(b);
  return (
    x.account_code === y.account_code &&
    x.vat_category_code === y.vat_category_code &&
    x.extract_line_items === y.extract_line_items
  );
}

/** O nome do fornecedor tal como o documento traz, com a loja atrás. */
const haystack = (identity: SupplierIdentity): string =>
  norm(`${identity.supplier_name ?? ""} ${identity.store_name ?? ""}`);

export function ruleMatchesIdentity(
  rule: SupplierRule,
  identity: SupplierIdentity
): SupplierMatchedBy | null {
  if (rule.active === false) return null;

  const docVat = vatKey(identity.supplier_vat);
  const ruleVat = vatKey(rule.supplier_vat);
  if (ruleVat && docVat && ruleVat === docVat) return "vat";

  const pattern = nameKey(rule.name_match);
  if (pattern.length >= MIN_NAME_MATCH && haystack(identity).includes(pattern)) return "name";

  return null;
}

/**
 * A regra que vale para este documento.
 *
 * Número de VAT primeiro: é o único identificador que não muda de forma de uma
 * nota para outra ("Tesco Stores", "TESCO IRELAND LTD" e "Tesco" são o mesmo
 * fornecedor com três nomes, mas um número só). Depois, nome — e entre nomes,
 * o padrão mais longo, que é o mais específico.
 */
export function matchSupplierRule(
  identity: SupplierIdentity,
  rules: SupplierRule[]
): SupplierRuleOutcome {
  const none: SupplierRuleOutcome = { rule: null, matchedBy: null, conflict: [] };

  const hits = rules
    .map((rule) => ({ rule, by: ruleMatchesIdentity(rule, identity) }))
    .filter((h): h is { rule: SupplierRule; by: SupplierMatchedBy } => h.by !== null);
  if (!hits.length) return none;

  const byVat = hits.filter((h) => h.by === "vat");
  let candidates: SupplierRule[];
  let matchedBy: SupplierMatchedBy;

  if (byVat.length) {
    candidates = byVat.map((h) => h.rule);
    matchedBy = "vat";
  } else {
    const longest = Math.max(...hits.map((h) => nameKey(h.rule.name_match).length));
    candidates = hits.filter((h) => nameKey(h.rule.name_match).length === longest).map((h) => h.rule);
    matchedBy = "name";
  }

  // Empate só é problema quando as regras discordam. Duas escritas iguais são
  // cadastro repetido, não ambiguidade — recusar aí seria alarme falso, e
  // alarme falso ensina o contador a ignorar aviso.
  const divergent = candidates.filter((c) => !sameDecision(c, candidates[0]));
  if (divergent.length) return { rule: null, matchedBy: null, conflict: candidates };

  return { rule: candidates[0], matchedBy, conflict: [] };
}

/*
 * Por que não existe aqui um `findConflictingRules` para a tela avisar antes de
 * a nota chegar, como as regras de banco fazem com `findShadowedRules`:
 *
 * O único conflito que daria para PROVAR sem um documento na mão é duas regras
 * com o mesmo número de VAT ou o mesmo pedaço de nome — e esse o banco já
 * recusa na gravação (índices únicos em `007_supplier_rules.sql`), com mensagem
 * dizendo qual dos dois repetiu. Um detector na tela seria código que nunca
 * dispara, dando a impressão de que uma conferência acontece.
 *
 * O conflito que sobra é o de padrões diferentes que casam com o MESMO
 * documento ("ireland" e "limited" contra "Vodafone Ireland Limited"), e esse
 * só existe diante de um documento. É lá que ele é dito: `matchSupplierRule`
 * devolve `conflict`, a leitura transforma isso em aviso do documento, e a nota
 * chega marcada para revisão em vez de chegar vazia sem explicação.
 */

// ------------------------------------------------------- itens desligados

export interface DocTotals {
  total_net: number | null;
  total_vat: number | null;
  total_gross: number | null;
}

/** Uma linha só, na mesma forma que a leitura produz. */
export interface CollapsedLine {
  description: string;
  quantity: null;
  unit_price: null;
  net_amount: number | null;
  vat_rate_on_invoice: number | null;
  /** O VAT que o próprio documento declara. É exato, então dispensa alíquota. */
  vat_amount_on_invoice: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * O documento inteiro como uma linha, para o fornecedor cujas linhas o
 * escritório não quer ver.
 *
 * O valor vem dos totais do documento, nunca da soma das linhas lidas: se a
 * leitura perdeu um item, a soma das linhas está errada e o total impresso
 * está certo. Trocar um pelo outro aqui seria trocar o número conferível pelo
 * número deduzido.
 *
 * O VAT vai como `vat_amount_on_invoice` de propósito: `lineVat` (lib/vat.ts)
 * prefere o VAT declarado a qualquer alíquota, então o crédito sai exato mesmo
 * quando a regra não diz categoria nenhuma.
 */
export function collapseToSingleLine(
  identity: SupplierIdentity,
  totals: DocTotals,
  ruleRate: number | null = null
): CollapsedLine {
  const gross = totals.total_gross;
  const vat = totals.total_vat;
  const net =
    totals.total_net != null
      ? totals.total_net
      : gross != null && vat != null
        ? r2(gross - vat)
        : gross != null
          ? gross
          : null;

  // A alíquota da regra manda; sem ela, a do próprio documento, que é
  // aritmética e não chute. Arredondada a uma casa porque é assim que as
  // alíquotas irlandesas se escrevem (23, 13.5, 9, 4.8, 0).
  const derived =
    ruleRate != null
      ? ruleRate
      : net != null && vat != null && net !== 0
        ? Math.round((vat / net) * 1000) / 10
        : null;

  const name = String(identity.supplier_name || identity.store_name || "").trim();

  return {
    description: name || "Documento sem itens detalhados",
    quantity: null,
    unit_price: null,
    net_amount: net,
    vat_rate_on_invoice: derived,
    vat_amount_on_invoice: vat,
  };
}
