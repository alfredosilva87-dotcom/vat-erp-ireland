/**
 * Reading a bank statement file into normalised lines.
 *
 * Every bank exports a different shape, so nothing about a format is hardcoded:
 * the layout is *data* (a ColumnMapping saved per bank account), and this
 * module only knows how to guess a sensible starting point and how to turn
 * rows + mapping into lines. Meeting a new bank is a mapping the accountant
 * confirms once on screen — never a code change.
 *
 * Two conventions the rest of the system relies on:
 *
 *  - **Amount is a single signed number**: positive is money in, negative is
 *    money out. Statements that use separate debit/credit columns are folded
 *    into that here, so nothing downstream has to care.
 *
 *  - **Every line carries a dedupe key** that is stable across re-imports.
 *    Re-importing an overlapping period is the most common mistake in
 *    reconciliation — the accountant downloads "January", then "January and
 *    February", and half the lines silently enter twice.
 */

export type AmountStyle = "signed" | "debit_credit";
export type DateStyle = "dmy" | "mdy" | "ymd";

export interface ColumnMapping {
  /** Index of the header row, or null when the file has no header. */
  headerRow: number | null;
  date: number;
  description: number | null;
  reference: number | null;
  payee: number | null;
  /** Single signed column (amountStyle = "signed"). */
  amount: number | null;
  /** Money out / money in (amountStyle = "debit_credit"). */
  debit: number | null;
  credit: number | null;
  balance: number | null;
  amountStyle: AmountStyle;
  dateStyle: DateStyle;
  /**
   * Some banks export outgoings as positive numbers in a signed column, with
   * the direction implied elsewhere. Flip when that is the case.
   */
  invertSign: boolean;
}

export interface StatementLine {
  line_date: string; // ISO yyyy-mm-dd
  description: string | null;
  payee: string | null;
  reference: string | null;
  /** Positive = money in, negative = money out. */
  amount: number;
  balance: number | null;
  dedupe_key: string;
  /** 1-based row in the source file, so a problem can be pointed at. */
  source_row: number;
}

export interface ParseProblem {
  row: number;
  reason: string;
}

/**
 * Summary rows: most statements end with a totals line, and some repeat one per
 * page. They have a real amount but no date, so they would otherwise be
 * reported as broken — training the accountant to ignore the problem list,
 * which is exactly when a genuine problem slips through. They are counted and
 * shown separately instead of being dropped in silence.
 */
const SUMMARY_HINTS = [
  "total", "totals", "subtotal", "sub-total", "balance", "saldo", "closing",
  "opening", "brought forward", "carried forward", "b/f", "c/f", "resumo",
];

function looksLikeSummary(row: unknown[]): boolean {
  return row.some((c) => {
    const v = norm(c);
    return v.length > 0 && v.length < 40 && SUMMARY_HINTS.some((h) => v === h || v.startsWith(`${h} `) || v.endsWith(` ${h}`));
  });
}

export interface DetectionResult {
  mapping: ColumnMapping;
  /** Human-readable notes about what was guessed and why. */
  notes: string[];
  confident: boolean;
}

// ---------------------------------------------------------------- primitives

const norm = (v: unknown) =>
  String(v ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Money as banks write it: "1.234,56", "1,234.56", "(45.00)" for negatives,
 * "€ 12,00", "12.00 CR". Returns null when there is no number at all, which is
 * different from a legitimate zero.
 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  let s = String(raw ?? "").trim();
  if (!s) return null;

  // Accounting notation: parentheses mean negative.
  let negative = /^\(.*\)$/.test(s);
  if (negative) s = s.slice(1, -1);

  // Trailing DR/CR markers, used by several European banks.
  const marker = /\b(dr|cr)\b\s*$/i.exec(s);
  if (marker) {
    if (marker[1].toLowerCase() === "dr") negative = true;
    s = s.slice(0, marker.index);
  }

  s = s.replace(/[^\d.,\-+]/g, "").trim(); // drop currency symbols and spaces
  if (!s || !/\d/.test(s)) return null;

  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever comes last is the decimal separator; the other groups digits.
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // A lone comma is decimal ("12,50") unless it is grouping ("1,234").
    const after = s.length - lastComma - 1;
    s = after === 3 && /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const after = s.length - lastDot - 1;
    if (after === 3 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Dates as banks write them. `style` decides the ambiguous case (03/04/2026):
 * Ireland and most of Europe write day first, so that is the default — but it
 * is part of the saved mapping, never a guess repeated per row.
 */
export function parseDate(raw: unknown, style: DateStyle = "dmy"): string | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(
      raw.getDate()
    ).padStart(2, "0")}`;
  }

  const s = String(raw ?? "").trim();
  if (!s) return null;

  // 2026-01-31
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (iso) return build(+iso[1], +iso[2], +iso[3]);

  // 31-Jan-2026 / 31 January 26
  const named = /^(\d{1,2})[\s\-/.]*([a-zA-Z]{3,})[\s\-/.]*(\d{2,4})/.exec(s);
  if (named) {
    const m = MONTHS[named[2].slice(0, 4).toLowerCase()] ?? MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (m) return build(year(+named[3]), m, +named[1]);
  }

  // 31/01/2026 or 01/31/2026
  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (numeric) {
    let a = +numeric[1];
    let b = +numeric[2];
    const y = year(+numeric[3]);
    // A value above 12 can only be the day, whatever the declared style says.
    if (style === "mdy" && a <= 12) return build(y, a, b);
    if (a > 12 && b <= 12) return build(y, b, a);
    if (b > 12 && a <= 12) return build(y, a, b);
    return build(y, b, a); // dmy
  }

  return null;

  function year(y: number) {
    return y < 100 ? (y >= 70 ? 1900 + y : 2000 + y) : y;
  }
  function build(y: number, m: number, d: number) {
    if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
}

// ----------------------------------------------------------------- detection

const HEADER_HINTS: Record<string, string[]> = {
  date: ["date", "data", "transaction date", "posted", "value date", "booking"],
  description: ["description", "details", "narrative", "particulars", "transaction", "memo", "descricao"],
  reference: ["reference", "ref", "cheque", "transaction id"],
  payee: ["payee", "beneficiary", "counterparty", "name", "to/from"],
  amount: ["amount", "value", "valor", "montante"],
  debit: ["debit", "money out", "paid out", "withdrawal", "out", "saida", "debito"],
  credit: ["credit", "money in", "paid in", "deposit", "lodgement", "in", "entrada", "credito"],
  balance: ["balance", "saldo", "running balance"],
};

/** Finds the header row and proposes a mapping. Never throws. */
export function detectLayout(rows: unknown[][]): DetectionResult {
  const notes: string[] = [];
  const empty: ColumnMapping = {
    headerRow: null, date: 0, description: null, reference: null, payee: null,
    amount: null, debit: null, credit: null, balance: null,
    amountStyle: "signed", dateStyle: "dmy", invertSign: false,
  };
  if (!rows.length) return { mapping: empty, notes: ["Arquivo vazio."], confident: false };

  // Statements often carry a few preamble rows (account holder, period) before
  // the real header, so look past the first line.
  let headerRow: number | null = null;
  let best = 0;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = (rows[i] || []).map(norm);
    const score = Object.values(HEADER_HINTS).reduce(
      (acc, hints) => acc + (cells.some((c) => c && hints.some((h) => c === h || c.includes(h))) ? 1 : 0),
      0
    );
    if (score > best) {
      best = score;
      headerRow = i;
    }
  }
  if (best < 2) {
    headerRow = null;
    notes.push("Nenhum cabeçalho reconhecido — confira o mapeamento das colunas.");
  }

  const mapping: ColumnMapping = { ...empty, headerRow };

  if (headerRow !== null) {
    const cells = (rows[headerRow] || []).map(norm);
    const findCol = (key: keyof typeof HEADER_HINTS) => {
      const hints = HEADER_HINTS[key];
      // Exact match first: "in" must not swallow "invoice".
      const exact = cells.findIndex((c) => c && hints.includes(c));
      if (exact >= 0) return exact;
      return cells.findIndex((c) => c && hints.some((h) => h.length > 3 && c.includes(h)));
    };
    mapping.date = Math.max(0, findCol("date"));
    mapping.description = nn(findCol("description"));
    mapping.reference = nn(findCol("reference"));
    mapping.payee = nn(findCol("payee"));
    mapping.balance = nn(findCol("balance"));

    const debit = nn(findCol("debit"));
    const credit = nn(findCol("credit"));
    const amount = nn(findCol("amount"));
    if (debit !== null && credit !== null) {
      mapping.amountStyle = "debit_credit";
      mapping.debit = debit;
      mapping.credit = credit;
      notes.push("Colunas separadas de entrada e saída detectadas.");
    } else if (amount !== null) {
      mapping.amount = amount;
    }
  }

  // Whatever the header said, confirm against the data: the amount column has
  // to actually hold numbers, and the date column dates.
  const body = rows.slice(headerRow === null ? 0 : headerRow + 1).filter((r) => r && r.some((c) => String(c ?? "").trim()));
  if (mapping.amount === null && mapping.amountStyle === "signed") {
    const guess = bestNumericColumn(body, [mapping.balance]);
    if (guess !== null) {
      mapping.amount = guess;
      notes.push(`Coluna de valor deduzida dos dados (coluna ${guess + 1}).`);
    }
  }
  if (headerRow === null) {
    const d = bestDateColumn(body);
    if (d !== null) mapping.date = d;
    if (mapping.description === null) {
      const t = bestTextColumn(body, [mapping.date, mapping.amount, mapping.balance]);
      if (t !== null) mapping.description = t;
    }
  }

  mapping.dateStyle = guessDateStyle(body, mapping.date);
  if (mapping.dateStyle === "mdy") notes.push("Datas parecem estar em mês/dia/ano.");

  const hasAmount = mapping.amountStyle === "debit_credit" ? mapping.debit !== null && mapping.credit !== null : mapping.amount !== null;
  const confident = headerRow !== null && hasAmount;
  if (!hasAmount) notes.push("Não identifiquei a coluna de valor — selecione manualmente.");

  return { mapping, notes, confident };

  function nn(i: number) {
    return i >= 0 ? i : null;
  }
}

function columnCount(rows: unknown[][]) {
  return rows.reduce((m, r) => Math.max(m, (r || []).length), 0);
}

function bestNumericColumn(rows: unknown[][], exclude: (number | null)[]) {
  let bestCol: number | null = null;
  let bestScore = 0;
  for (let c = 0; c < columnCount(rows); c++) {
    if (exclude.includes(c)) continue;
    let hits = 0;
    let signs = 0;
    for (const r of rows) {
      const v = parseAmount(r?.[c]);
      if (v !== null) {
        hits++;
        if (v < 0) signs++;
      }
    }
    // A signed column beats a column of positive-only numbers, which is more
    // likely to be a balance or a quantity.
    const score = hits + (signs > 0 ? rows.length : 0);
    if (hits >= Math.max(1, rows.length * 0.6) && score > bestScore) {
      bestScore = score;
      bestCol = c;
    }
  }
  return bestCol;
}

function bestDateColumn(rows: unknown[][]) {
  for (let c = 0; c < columnCount(rows); c++) {
    const hits = rows.filter((r) => parseDate(r?.[c]) !== null).length;
    if (hits >= Math.max(1, rows.length * 0.6)) return c;
  }
  return null;
}

function bestTextColumn(rows: unknown[][], exclude: (number | null)[]) {
  let bestCol: number | null = null;
  let bestLen = 0;
  for (let c = 0; c < columnCount(rows); c++) {
    if (exclude.includes(c)) continue;
    const len = rows.reduce((a, r) => a + String(r?.[c] ?? "").trim().length, 0);
    if (len > bestLen) {
      bestLen = len;
      bestCol = c;
    }
  }
  return bestCol;
}

/**
 * Day-first vs month-first, decided over the whole file rather than per row —
 * a single 03/04 tells you nothing, but one 31/01 anywhere settles it.
 */
function guessDateStyle(rows: unknown[][], col: number): DateStyle {
  let firstOver12 = 0;
  let secondOver12 = 0;
  for (const r of rows) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(String(r?.[col] ?? "").trim());
    if (!m) continue;
    if (+m[1] > 12) firstOver12++;
    if (+m[2] > 12) secondOver12++;
  }
  if (secondOver12 > firstOver12) return "mdy";
  return "dmy";
}

// ------------------------------------------------------------------ building

/**
 * Stable identity of a statement line, so the same line read twice is
 * recognised as the same line.
 *
 * The occurrence counter matters more than it looks: two identical €4.50
 * coffees on the same day are *not* duplicates, and keying only on
 * date+amount+description would silently swallow the second one. Counting
 * occurrences within the file keeps genuine repeats while still rejecting a
 * re-imported file, because the same file always produces the same sequence.
 */
function dedupeKey(date: string, amount: number, description: string, occurrence: number) {
  const base = [date, amount.toFixed(2), norm(description).slice(0, 80), occurrence].join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < base.length; i++) {
    const c = base.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

export function buildLines(
  rows: unknown[][],
  mapping: ColumnMapping
): { lines: StatementLine[]; problems: ParseProblem[]; summaryRows: number[] } {
  const lines: StatementLine[] = [];
  const problems: ParseProblem[] = [];
  const summaryRows: number[] = [];
  const seen = new Map<string, number>();

  const start = mapping.headerRow === null ? 0 : mapping.headerRow + 1;
  const cell = (r: unknown[], i: number | null) => (i === null || i < 0 ? "" : r?.[i]);

  for (let i = start; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some((c) => String(c ?? "").trim())) continue;

    const date = parseDate(cell(r, mapping.date), mapping.dateStyle);

    let amount: number | null;
    if (mapping.amountStyle === "debit_credit") {
      const out = parseAmount(cell(r, mapping.debit));
      const inn = parseAmount(cell(r, mapping.credit));
      amount = out === null && inn === null ? null : (inn ?? 0) - Math.abs(out ?? 0);
    } else {
      amount = parseAmount(cell(r, mapping.amount));
      if (amount !== null && mapping.invertSign) amount = -amount;
    }

    if (!date && amount === null) continue; // blank separators
    if (!date && looksLikeSummary(r)) {
      summaryRows.push(i + 1);
      continue;
    }
    if (!date) {
      problems.push({ row: i + 1, reason: "Data não reconhecida" });
      continue;
    }
    if (amount === null) {
      problems.push({ row: i + 1, reason: "Valor não reconhecido" });
      continue;
    }

    const description = String(cell(r, mapping.description) ?? "").trim() || null;
    const groupKey = `${date}|${amount.toFixed(2)}|${norm(description ?? "")}`;
    const occurrence = (seen.get(groupKey) ?? 0) + 1;
    seen.set(groupKey, occurrence);

    lines.push({
      line_date: date,
      description,
      payee: String(cell(r, mapping.payee) ?? "").trim() || null,
      reference: String(cell(r, mapping.reference) ?? "").trim() || null,
      amount: Number(amount.toFixed(2)),
      balance: parseAmount(cell(r, mapping.balance)),
      dedupe_key: dedupeKey(date, amount, description ?? "", occurrence),
      source_row: i + 1,
    });
  }

  return { lines, problems, summaryRows };
}

/**
 * Which of these lines the account has never seen.
 *
 * The database's unique index is the real guard — this is what lets the screen
 * say "38 novas, 12 já importadas" *before* saving. Without it the accountant
 * imports an overlapping period, sees "12 ignoradas" afterwards, and has no way
 * to tell whether that was expected or a file mixed up with another account.
 */
export function splitByExisting(
  lines: StatementLine[],
  existingKeys: Iterable<string>
): { fresh: StatementLine[]; alreadyImported: StatementLine[] } {
  const known = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  const fresh: StatementLine[] = [];
  const alreadyImported: StatementLine[] = [];
  for (const l of lines) (known.has(l.dedupe_key) ? alreadyImported : fresh).push(l);
  return { fresh, alreadyImported };
}

/**
 * Sanity check against the statement's own running balance, when the file has
 * one. Catches a wrong sign convention or a missed column immediately, instead
 * of at month end when the reconciliation refuses to close.
 */
export function checkAgainstBalance(lines: StatementLine[]): string | null {
  const withBalance = lines.filter((l) => l.balance !== null);
  if (withBalance.length < 2) return null;

  const first = withBalance[0];
  const last = withBalance[withBalance.length - 1];
  const movement = withBalance
    .slice(1)
    .reduce((a, l) => a + l.amount, 0);
  const expected = Number(((first.balance as number) + movement).toFixed(2));
  const actual = last.balance as number;

  if (Math.abs(expected - actual) > 0.01) {
    return `O saldo do arquivo não fecha com a soma dos valores (esperado ${expected.toFixed(
      2
    )}, arquivo diz ${actual.toFixed(2)}). Confira a coluna de valor e o sinal.`;
  }
  return null;
}
