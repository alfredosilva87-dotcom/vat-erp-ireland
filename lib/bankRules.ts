/**
 * Regras de banco (camada A3).
 *
 * É o que faz o segundo mês ser mais rápido que o primeiro: a tarifa mensal, o
 * débito direto da luz e o aluguel deixam de ser decididos de novo a cada
 * importação.
 *
 * Duas coisas moldam o desenho, e as duas vêm do Xero:
 *
 *   1. **Para na primeira regra que casa.** Não é detalhe de implementação: uma
 *      regra genérica no topo engole todas as específicas abaixo dela, e quem
 *      escreveu as específicas jura que elas funcionam. A ordem é visível e
 *      reordenável na tela por isso.
 *
 *   2. **Regra sugere, nunca lança sozinha.** O contador confirma. Uma regra
 *      errada que lança sozinha vira mil lançamentos errados antes de alguém
 *      olhar.
 *
 * Função pura: linha e regras entram, sugestão sai. Sem banco, para que cada
 * regra abaixo seja testável e um resultado errado seja reproduzível.
 */

export type RuleField = "description" | "payee" | "reference" | "amount";
export type RuleOp = "contains" | "equals" | "starts_with" | "gt" | "lt";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: string;
}

export interface RuleAllocation {
  account_code: string | null;
  vat_rate: number | null;
  /** Percentual do valor da linha. Use isto **ou** `amount`, não os dois. */
  percent?: number | null;
  /** Valor fixo, com sinal ignorado — o sinal vem da linha. */
  amount?: number | null;
  description?: string | null;
}

export interface BankRule {
  id: string;
  name: string;
  priority: number;
  /** true = todas as condições; false = qualquer uma. */
  match_all: boolean;
  conditions: RuleCondition[];
  allocations: RuleAllocation[];
  contact_name: string | null;
  /** Nulo = vale para todas as contas do cliente. */
  bank_account_id: string | null;
  active: boolean;
}

export interface RuleLine {
  description: string | null;
  payee: string | null;
  reference: string | null;
  amount: number;
}

/** Uma parte do valor da linha, já resolvida em dinheiro. */
export interface ResolvedAllocation {
  account_code: string | null;
  vat_rate: number | null;
  amount: number;
  description: string | null;
}

export interface RuleOutcome {
  rule: BankRule;
  allocations: ResolvedAllocation[];
  /** Regras que também casariam, mas perderam pela ordem. */
  shadowed: BankRule[];
}

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

function fieldValue(line: RuleLine, field: RuleField): string {
  if (field === "amount") return String(line.amount);
  return String(line[field] ?? "");
}

function testCondition(line: RuleLine, c: RuleCondition): boolean {
  if (c.field === "amount") {
    // Comparação de valor é sobre a MAGNITUDE: o contador pensa em "acima de
    // 500 euros", não em "menor que -500".
    const target = parseFloat(String(c.value).replace(",", "."));
    if (!Number.isFinite(target)) return false;
    const v = Math.abs(line.amount);
    const t = Math.abs(target);
    if (c.op === "gt") return v > t;
    if (c.op === "lt") return v < t;
    return Math.abs(v - t) <= 0.01;
  }

  const haystack = norm(fieldValue(line, c.field));
  const needle = norm(c.value);
  if (!needle) return false;
  if (c.op === "equals") return haystack === needle;
  if (c.op === "starts_with") return haystack.startsWith(needle);
  return haystack.includes(needle);
}

export function ruleMatches(line: RuleLine, rule: BankRule, accountId?: string | null): boolean {
  if (!rule.active) return false;
  if (rule.bank_account_id && accountId && rule.bank_account_id !== accountId) return false;
  const conds = rule.conditions ?? [];
  // Regra sem condição casaria com tudo. Isso é sempre engano de quem cadastrou,
  // e o estrago é grande porque ela para todas as outras.
  if (!conds.length) return false;
  return rule.match_all
    ? conds.every((c) => testCondition(line, c))
    : conds.some((c) => testCondition(line, c));
}

/**
 * Splits the line amount over the rule's allocations.
 *
 * Percentages almost never divide cleanly — 33,33% de €100 três vezes dá
 * €99,99. A sobra vai para a MAIOR parcela, que é onde ela some no ruído; se
 * ficasse de fora, a soma das partes não fecharia com a linha e a conciliação
 * não poderia ser provada.
 */
export function resolveAllocations(amount: number, allocations: RuleAllocation[]): ResolvedAllocation[] {
  const list = (allocations ?? []).filter((a) => a && (a.percent != null || a.amount != null || a.account_code));
  if (!list.length) {
    return [{ account_code: null, vat_rate: null, amount: Number(amount.toFixed(2)), description: null }];
  }

  const sign = amount < 0 ? -1 : 1;
  const total = Math.abs(amount);

  const raw = list.map((a) => {
    if (a.percent != null) return (total * Number(a.percent)) / 100;
    if (a.amount != null) return Math.abs(Number(a.amount));
    return NaN; // parcela sem valor: recebe o resto abaixo
  });

  const fixedSum = raw.filter((v) => Number.isFinite(v)).reduce((s, v) => s + v, 0);
  const blanks = raw.filter((v) => !Number.isFinite(v)).length;
  const share = blanks ? Math.max(0, total - fixedSum) / blanks : 0;

  const rounded = raw.map((v) => Number((Number.isFinite(v) ? v : share).toFixed(2)));
  const diff = Number((total - rounded.reduce((s, v) => s + v, 0)).toFixed(2));
  if (Math.abs(diff) >= 0.01) {
    let biggest = 0;
    for (let i = 1; i < rounded.length; i++) if (rounded[i] > rounded[biggest]) biggest = i;
    rounded[biggest] = Number((rounded[biggest] + diff).toFixed(2));
  }

  return list.map((a, i) => ({
    account_code: a.account_code ?? null,
    vat_rate: a.vat_rate ?? null,
    amount: Number((rounded[i] * sign).toFixed(2)),
    description: a.description ?? null,
  }));
}

/**
 * The first rule that matches, in priority order — and which other rules it
 * shadowed, so the screen can say "esta regra está engolindo aquelas".
 */
export function applyRules(
  line: RuleLine, rules: BankRule[], accountId?: string | null
): RuleOutcome | null {
  const ordered = [...(rules ?? [])].sort((a, b) => a.priority - b.priority);
  const hits = ordered.filter((r) => ruleMatches(line, r, accountId));
  if (!hits.length) return null;
  const [rule, ...shadowed] = hits;
  return { rule, allocations: resolveAllocations(line.amount, rule.allocations), shadowed };
}

/**
 * Rules that can never fire because an earlier, broader rule always wins.
 *
 * A tela precisa disto porque o sintoma é mudo: a regra específica está lá,
 * escrita certa, e simplesmente nunca acontece.
 */
export function findShadowedRules(rules: BankRule[]): Array<{ rule: BankRule; shadowedBy: BankRule }> {
  const ordered = [...(rules ?? [])].filter((r) => r.active).sort((a, b) => a.priority - b.priority);
  const out: Array<{ rule: BankRule; shadowedBy: BankRule }> = [];

  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < i; j++) {
      if (covers(ordered[j], ordered[i])) {
        out.push({ rule: ordered[i], shadowedBy: ordered[j] });
        break;
      }
    }
  }
  return out;

  // "Cobre" no sentido conservador: só avisa quando dá para provar. Uma regra
  // ampla de "contém TESCO" engole "contém TESCO EXPRESS", porque tudo que
  // casa com a segunda casa com a primeira.
  function covers(broad: BankRule, narrow: BankRule): boolean {
    if (broad.bank_account_id && broad.bank_account_id !== narrow.bank_account_id) return false;
    if (!broad.match_all || !narrow.match_all) return false;
    const bc = broad.conditions ?? [];
    const nc = narrow.conditions ?? [];
    if (!bc.length || !nc.length) return false;
    return bc.every((b) =>
      nc.some((n) => {
        if (n.field !== b.field) return false;
        if (b.field === "amount") return false; // faixas numéricas: não arrisca
        const bv = norm(b.value);
        const nv = norm(n.value);
        if (b.op === "contains") return nv.includes(bv);
        if (b.op === "starts_with") return n.op === "starts_with" ? nv.startsWith(bv) : nv.startsWith(bv);
        if (b.op === "equals") return n.op === "equals" && nv === bv;
        return false;
      })
    );
  }
}
