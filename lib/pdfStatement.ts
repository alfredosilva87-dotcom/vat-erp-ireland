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
import { parseAmount, parseDate } from "./bankStatement";

export interface PdfRowsResult {
  /** [data, descrição, ...números] — pronto para detectLayout/buildLines. */
  rows: unknown[][];
  notes: string[];
  /** true quando o sinal veio do saldo corrido, não da forma da linha. */
  signFromBalance: boolean;
  /** Linhas de texto que não viraram movimento (cabeçalho, rodapé, totais). */
  ignored: number;
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
