/**
 * Extrato bancário em PDF (camada A6).
 *
 * PDF não tem colunas: tem texto solto com posições. O que sai de um extrato
 * digital é uma linha por movimento, mais ou menos assim:
 *
 *     02/01/2026  TESCO STORES, DUBLIN        45.20      954.80
 *
 * Reconstruir a tabela a partir disso tem uma armadilha que é a razão de este
 * arquivo existir: **coluna vazia desaparece**. Num extrato com saída e entrada
 * em colunas separadas, a linha de saída e a linha de entrada saem do PDF com
 * exatamente a mesma forma — data, descrição, dois números. Não dá para saber
 * pelo formato se aquele valor entrou ou saiu.
 *
 * A saída é usar a aritmética do próprio documento: se o extrato traz saldo
 * corrido, o sinal do movimento é `saldo_atual - saldo_anterior`. É o documento
 * se explicando, e não um palpite sobre layout.
 *
 * Quando não dá para resolver assim, os números são devolvidos como colunas
 * separadas e quem decide é o contador, na mesma tela de confirmação do CSV.
 *
 * Função pura de propósito: texto entra, grade sai. Sem PDF, sem rede.
 */

// Import relativo (e não pelo alias `@/`) para que `npm test` consiga compilar
// este arquivo sozinho, sem o resolvedor de caminhos do Next.
import { parseAmount, parseDate, type ColumnMapping } from "./bankStatement";

export interface PdfRowsResult {
  /** [data, descrição, ...números] — pronto para detectLayout/buildLines. */
  rows: unknown[][];
  notes: string[];
  /** true quando o sinal veio do saldo corrido, não da forma da linha. */
  signFromBalance: boolean;
  /** Linhas de texto que não viraram movimento (cabeçalho, rodapé, totais). */
  ignored: number;
  /**
   * Quando as colunas foram lidas do cabeçalho do PDF, não há o que adivinhar:
   * o mapeamento já vem pronto e a tela só confirma.
   */
  mapping?: ColumnMapping;
  /** Saldo anterior, quando o extrato traz a linha "balance forward". */
  openingBalance?: number | null;
}

/**
 * Um número como um extrato imprime: sempre com os dois centavos.
 *
 * Os centavos são o que separa dinheiro de qualquer outro número da linha
 * ("INV 2026-014", "Unit 4"). Aceita tanto `1.234,56` quanto `3454.80` — exigir
 * grupos de três descartava justamente os valores acima de mil. O espaço só é
 * permitido dentro de um grupo de milhar, senão o vão entre duas colunas seria
 * engolido e dois números virariam um.
 */
const MONEY_G = /[(\-+]?\s?€?\s?(?:\d{1,3}(?:[.,  ]\d{3})+|\d+)[.,]\d{2}\)?(?:\s?(?:CR|DR))?/gi;

/**
 * Um começo de linha que é data. Deliberadamente restrito ao começo: número no
 * meio da descrição ("INV 2026-014") não pode virar data da linha.
 */
const LEADING_DATE =
  /^\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[\s-][A-Za-z]{3,9}[\s-]\d{2,4})\b/;

/** Rodapé de página e cabeçalho repetido: não são movimento. */
const NOISE = [
  /^\s*page\s+\d+/i, /^\s*p[áa]gina\s+\d+/i, /^\s*\d+\s+of\s+\d+\s*$/i,
  /continued/i, /^\s*date\b.*\b(description|details|amount|balance)/i,
  /^\s*data\b.*\b(descri|valor|saldo)/i,
];

// ============================================================ leitura por coluna

/**
 * Uma linha do PDF com a posição de cada pedaço de texto. Repetido aqui (em vez
 * de importado de `lib/extractor/pdfLayout`) para este módulo continuar puro e
 * compilável sozinho nos testes.
 */
export interface PositionedLine {
  page: number;
  y: number;
  cells: Array<{ text: string; x: number; right: number }>;
}

type ColRole = "date" | "description" | "debit" | "credit" | "amount" | "balance";

const HEADER_WORDS: Array<{ role: ColRole; words: string[] }> = [
  { role: "date", words: ["date", "data"] },
  { role: "description", words: ["details", "description", "narrative", "particulars", "descricao", "descrição"] },
  { role: "debit", words: ["debit", "debito", "débito", "paid out", "money out", "withdrawn", "saida", "saída"] },
  { role: "credit", words: ["credit", "credito", "crédito", "paid in", "money in", "lodged", "entrada"] },
  { role: "amount", words: ["amount", "valor", "montante"] },
  { role: "balance", words: ["balance", "saldo"] },
];

const clean = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[€$£]/g, "").replace(/\s+/g, " ").trim();

/**
 * Turns positioned text into a real table.
 *
 * É aqui que a **célula vazia sobrevive**: uma linha só com valor na faixa do
 * débito é uma saída, e a mesma linha com o valor 40 pontos à direita é uma
 * entrada. No texto corrido as duas são idênticas.
 */
export function pdfLinesToRows(lines: PositionedLine[]): PdfRowsResult {
  const notes: string[] = [];
  const header = findHeader(lines);
  if (!header) {
    return { rows: [], notes: ["Não achei o cabeçalho de colunas neste PDF."], signFromBalance: false, ignored: lines.length };
  }

  const cols = header.cols;
  const hasSplit = cols.some((c) => c.role === "debit") && cols.some((c) => c.role === "credit");
  const rows: unknown[][] = [];
  let currentDate: string | null = null;
  let openingBalance: number | null = null;
  let ignored = 0;
  // Em que página está a última linha emitida: continuação só continua algo da
  // MESMA página. Sem isto, o endereço e o cabeçalho impressos no topo da
  // página seguinte entram na descrição do último movimento da página anterior.
  let lastRowPage = -1;

  const dateCol = cols.find((c) => c.role === "date");
  const descCol = cols.find((c) => c.role === "description");
  // O cabeçalho se repete a cada página, e tudo que vem acima dele é papel
  // timbrado: nome, endereço, IBAN, "BALANCE FORWARD".
  const headerY = headerPerPage(lines);

  for (const line of lines) {
    const cut = headerY.get(line.page);
    if (cut !== undefined && line.y >= cut) { ignored++; continue; }
    if (isHeaderLine(line)) { ignored++; continue; }

    const picked: Partial<Record<ColRole, number>> = {};
    const words: string[] = [];
    let sawDate = false;

    for (const cell of line.cells) {
      const role = nearestRole(cell.right, cols);

      // Data só onde a data mora, e só se realmente for uma data.
      if (role === "date" && dateCol && Math.abs(cell.x - dateCol.x) < 25) {
        const d = parseDate(cell.text);
        if (d) { currentDate = d; sawDate = true; continue; }
      }

      const value = MONEY_LINE.test(cell.text.trim()) ? parseAmount(cell.text) : null;
      if (value !== null && role !== "date" && role !== "description") {
        picked[role] = value;
        continue;
      }

      words.push(cell.text);
    }

    const movement = picked.debit ?? picked.credit ?? picked.amount;
    const text = words.join(" ").trim();

    if (movement === undefined) {
      // Sem valor de movimento: ou é continuação da descrição da linha de cima
      // (referência, "TxnDate: ..."), ou é o saldo anterior, ou é rodapé.
      if (picked.balance !== undefined && !rows.length) {
        openingBalance = picked.balance;
        ignored++;
        continue;
      }
      const last = rows[rows.length - 1];
      const looksLikeDetail =
        !!last && line.page === lastRowPage && !!text && text.length < 60 &&
        (!descCol || line.cells.some((c) => Math.abs(c.x - descCol.x) < 25));
      if (looksLikeDetail) {
        last[1] = `${last[1] ?? ""} ${text}`.trim();
        // O saldo do dia costuma vir na última linha do bloco, sem valor
        // próprio: ele pertence ao movimento de cima.
        if (picked.balance !== undefined && last[last.length - 1] == null) last[last.length - 1] = picked.balance;
      } else ignored++;
      continue;
    }

    if (!currentDate) { ignored++; continue; }
    if (!sawDate && !text && movement === undefined) { ignored++; continue; }

    rows.push(hasSplit
      ? [currentDate, text, picked.debit ?? null, picked.credit ?? null, picked.balance ?? null]
      : [currentDate, text, picked.amount ?? null, picked.balance ?? null]);
    lastRowPage = line.page;
  }

  if (!rows.length) {
    return { rows: [], notes: ["Achei o cabeçalho, mas nenhum movimento abaixo dele."], signFromBalance: false, ignored };
  }

  notes.push(hasSplit
    ? "Colunas lidas pela posição no PDF: saída e entrada vêm separadas, como no papel."
    : "Colunas lidas pela posição no PDF.");
  if (openingBalance !== null) notes.push(`Saldo anterior no extrato: ${openingBalance.toFixed(2)}.`);

  const mapping: ColumnMapping = hasSplit
    ? {
        headerRow: null, date: 0, description: 1, reference: null, payee: null,
        amount: null, debit: 2, credit: 3, balance: 4,
        amountStyle: "debit_credit", dateStyle: "dmy", invertSign: false,
      }
    : {
        headerRow: null, date: 0, description: 1, reference: null, payee: null,
        amount: 2, debit: null, credit: null, balance: 3,
        amountStyle: "signed", dateStyle: "dmy", invertSign: false,
      };

  return { rows, notes, signFromBalance: false, ignored, mapping, openingBalance };
}

/** Um valor sozinho numa célula. */
const MONEY_LINE = /^[(\-+]?\s?€?\s?(?:\d{1,3}(?:[.,  ]\d{3})+|\d+)[.,]\d{2}\)?(?:\s?(?:CR|DR))?$/i;

function roleOf(text: string): ColRole | null {
  const t = clean(text);
  if (!t || t.length > 20) return null;
  for (const { role, words } of HEADER_WORDS) {
    if (words.some((w) => t === w || t.startsWith(`${w} `) || t === `${w}s`)) return role;
  }
  return null;
}

function isHeaderLine(line: PositionedLine): boolean {
  const roles = new Set(line.cells.map((c) => roleOf(c.text)).filter(Boolean) as ColRole[]);
  return roles.has("date") && (roles.has("balance") || roles.has("debit") || roles.has("amount"));
}

/**
 * O cabeçalho é o que ensina onde cada coluna mora. Sem ele não há como saber
 * se um número é saída, entrada ou saldo — e chutar aqui é errar o sinal do
 * dinheiro, que é o pior erro possível neste sistema.
 */
/** A altura do cabeçalho em cada página que tem um. */
function headerPerPage(lines: PositionedLine[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const line of lines) {
    if (!isHeaderLine(line)) continue;
    const seen = out.get(line.page);
    // O mais BAIXO da página: se por acaso houver dois, o de baixo é o que
    // começa a tabela.
    if (seen === undefined || line.y < seen) out.set(line.page, line.y);
  }
  return out;
}

function findHeader(lines: PositionedLine[]): { page: number; y: number; cols: Array<{ role: ColRole; x: number; right: number }> } | null {
  for (const line of lines) {
    if (!isHeaderLine(line)) continue;
    const cols: Array<{ role: ColRole; x: number; right: number }> = [];
    for (const cell of line.cells) {
      const role = roleOf(cell.text);
      if (role && !cols.some((c) => c.role === role)) cols.push({ role, x: cell.x, right: cell.right });
    }
    if (cols.length >= 3) return { page: line.page, y: line.y, cols };
  }
  return null;
}

/**
 * A qual coluna pertence um valor.
 *
 * Pela borda DIREITA: número em extrato é alinhado à direita, e é essa borda
 * que fica estável entre "10.00" e "1.234,56".
 */
function nearestRole(right: number, cols: Array<{ role: ColRole; x: number; right: number }>): ColRole {
  let best = cols[0];
  for (const c of cols) if (Math.abs(c.right - right) < Math.abs(best.right - right)) best = c;
  return best.role;
}

/** Um valor com a coluna em que ele foi impresso. */
interface MoneyToken { value: number; at: number }
interface Draft { date: string; description: string; numbers: MoneyToken[] }

function moneyTokens(s: string): MoneyToken[] {
  const out: MoneyToken[] = [];
  MONEY_G.lastIndex = 0;
  for (let m = MONEY_G.exec(s); m; m = MONEY_G.exec(s)) {
    const value = parseAmount(m[0]);
    if (value !== null) out.push({ value, at: m.index });
  }
  return out;
}

export function pdfTextToRows(text: string): PdfRowsResult {
  const notes: string[] = [];
  const lines = String(text ?? "").split(/\r?\n/);

  const drafts: Draft[] = [];
  let ignored = 0;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    if (NOISE.some((re) => re.test(line))) { ignored++; continue; }

    const dm = LEADING_DATE.exec(line);
    if (!dm) {
      // Descrição que quebrou em duas linhas continua na anterior — sem isto,
      // metade do nome do fornecedor se perde e o casamento da A2 piora.
      const prev = drafts[drafts.length - 1];
      const t = line.trim();
      if (prev && t && !moneyTokens(t).length && t.length < 60) prev.description += ` ${t}`;
      else ignored++;
      continue;
    }

    const date = parseDate(dm[1]);
    if (!date) { ignored++; continue; }

    // A COLUNA em que o número está impresso é guardada junto com ele. Num PDF
    // renderizado em texto, essa posição é o que sobrou do layout original — e
    // é o que permite dizer, na primeira linha do extrato, se aquele valor
    // estava na coluna de saída ou na de entrada.
    const rest = line.slice(dm[0].length);
    const numbers = moneyTokens(rest);
    if (!numbers.length) { ignored++; continue; }

    const description = rest.slice(0, numbers[0].at).trim();
    drafts.push({ date, description, numbers });
  }

  if (!drafts.length) {
    return { rows: [], notes: ["Nenhum movimento reconhecido no texto do PDF."], signFromBalance: false, ignored };
  }

  const resolved = resolveByRunningBalance(drafts);
  if (resolved) {
    notes.push("Sinal de cada movimento deduzido do saldo corrido do próprio extrato.");
    return { rows: resolved, notes, signFromBalance: true, ignored };
  }

  const width = Math.max(...drafts.map((d) => d.numbers.length));
  if (width > 1) {
    notes.push(
      "O extrato não traz saldo corrido coerente, então não dá para deduzir o que entrou e o que saiu. " +
      "Confira as colunas de valor abaixo."
    );
  }
  return {
    rows: drafts.map((d) => [d.date, d.description, ...d.numbers.map((n) => n.value)]),
    notes,
    signFromBalance: false,
    ignored,
  };
}

/**
 * Tries to read the last number of each row as a running balance.
 *
 * When it fits, the movement is `saldo - saldo_anterior` — signed by the
 * document itself, não por um palpite sobre o layout.
 */
function resolveByRunningBalance(drafts: Draft[]): unknown[][] | null {
  if (drafts.length < 2) return null;
  if (!drafts.every((d) => d.numbers.length >= 2)) return null;

  const balances = drafts.map((d) => d.numbers[d.numbers.length - 1].value);
  const out: unknown[][] = [];
  // Em que coluna estava impresso o valor de cada linha já resolvida. É daqui
  // que sai o sinal da primeira linha, que não tem saldo anterior.
  const columnOf: Array<{ at: number; sign: number }> = [];
  let agree = 0;

  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const candidates = d.numbers.slice(0, -1);
    let amount: number | null = null;

    if (i > 0) {
      const delta = Number((balances[i] - balances[i - 1]).toFixed(2));
      // O valor tem que ser um dos números impressos na linha, a menos do sinal.
      const hit = candidates.find((c) => Math.abs(Math.abs(c.value) - Math.abs(delta)) <= 0.011);
      if (hit) {
        amount = delta;
        agree++;
        if (delta !== 0) columnOf.push({ at: hit.at, sign: Math.sign(delta) });
      }
    }
    out.push([d.date, d.description, amount, balances[i]]);
  }

  // Exigir que a maioria feche: uma coincidência solta não é um saldo corrido.
  if (agree / (drafts.length - 1) < 0.8) return null;

  if (out[0][2] === null) {
    // A primeira linha não tem saldo anterior para comparar, então o sinal vem
    // da COLUNA: saída e entrada são impressas em posições diferentes, e as
    // linhas seguintes — essas sim conferidas contra o saldo — dizem qual
    // posição é qual. Deduzir pelo sinal da linha de baixo, como cheguei a
    // fazer, é só chutar: uma entrada logo depois não torna a primeira entrada.
    const first = drafts[0].numbers[0];
    const nearest = columnOf.reduce<{ at: number; sign: number } | null>(
      (best, c) => (!best || Math.abs(c.at - first.at) < Math.abs(best.at - first.at) ? c : best),
      null
    );
    const signs = new Set(columnOf.map((c) => c.sign));
    if (nearest && Math.abs(nearest.at - first.at) <= 3) {
      out[0][2] = Number((Math.abs(first.value) * nearest.sign).toFixed(2));
    } else if (nearest && signs.size === 1) {
      // O valor não está em nenhuma coluna conhecida, e só uma coluna foi
      // identificada até aqui. Num extrato de saída/entrada só existem duas —
      // então esta é a outra, e o sinal é o oposto.
      out[0][2] = Number((Math.abs(first.value) * -nearest.sign).toFixed(2));
    } else {
      // Coluna irreconhecível: entrega como está impresso, sem fingir que sabe.
      out[0][2] = first.value;
    }
  }

  return out;
}
