/**
 * A carga de saldos de abertura.
 *
 * Um cliente que chega traz o balancete de fechamento do sistema antigo:
 * código, nome da conta, débito e crédito. Este arquivo lê esse texto,
 * aplica o de-para e diz o que ficou de fora — que é exatamente onde
 * mora o erro numa migração.
 *
 * Puro, sem banco: é o que permite testar as formas de o arquivo do
 * cliente estar torto (vírgula decimal, milhar com ponto, parênteses
 * para negativo, coluna a mais) sem precisar de uma base montada.
 */

export type LinhaLida = {
  external_code: string;
  external_name: string;
  debit: number;
  credit: number;
  /** A linha do arquivo, para a tela poder apontar onde está o problema. */
  line: number;
};

export type LinhaMapeada = LinhaLida & { account_code: string };

/**
 * Lê um número como ele aparece num balancete real.
 *
 * O mesmo arquivo pode trazer `1.234,56` (formato português/irlandês com
 * vírgula decimal), `1,234.56` (formato inglês) e `(500,00)` para
 * negativo. Errar isto por mil vezes é o erro mais caro possível numa
 * carga — e passa despercebido, porque o balanço continua a fechar.
 */
export function lerNumero(bruto: string): number {
  let s = String(bruto ?? "").trim();
  if (!s) return 0;

  // Parênteses são negativo em toda contabilidade de língua inglesa.
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negativo = true;
    s = s.slice(1);
  }

  s = s.replace(/[€$£\s]/g, "");
  if (!s) return 0;

  /*
   * Qual separador é o decimal? O ÚLTIMO que aparecer, quando vier
   * seguido de uma ou duas casas. `1.234,56` e `1,234.56` só se
   * distinguem por isso; assumir um dos dois multiplica ou divide por
   * mil um saldo em cada arquivo que vier do outro formato.
   */
  const ultimaVirgula = s.lastIndexOf(",");
  const ultimoPonto = s.lastIndexOf(".");
  const decimal = Math.max(ultimaVirgula, ultimoPonto);

  if (decimal >= 0 && s.length - decimal - 1 <= 2 && s.length - decimal - 1 > 0) {
    const inteiro = s.slice(0, decimal).replace(/[.,]/g, "");
    const casas = s.slice(decimal + 1);
    s = `${inteiro}.${casas}`;
  } else {
    // Sem decimal: tudo o que houver é separador de milhar.
    s = s.replace(/[.,]/g, "");
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round((negativo ? -n : n) * 100) / 100;
}

/**
 * Lê o balancete colado.
 *
 * Aceita tabulação, ponto e vírgula ou vírgula como separador — é o que
 * sai de um Excel colado, de um CSV exportado e de um relatório copiado
 * da tela do sistema antigo, e obrigar a pessoa a converter o arquivo
 * antes é onde uma migração morre.
 *
 * Formato esperado: `código  nome  débito  crédito`. Com três colunas,
 * a última é um saldo com sinal (positivo devedor).
 */
export function parseTrialBalance(texto: string): { rows: LinhaLida[]; ignored: number } {
  const rows: LinhaLida[] = [];
  let ignored = 0;

  const linhas = String(texto ?? "").split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    const bruta = linhas[i].trim();
    if (!bruta) continue;

    const partes = bruta.includes("\t") ? bruta.split("\t")
      : bruta.includes(";") ? bruta.split(";")
      : bruta.split(",").length > 3 ? bruta.split(",")
      : bruta.split(/\s{2,}/);

    const campos = partes.map((p) => p.trim());
    if (campos.length < 2) { ignored++; continue; }

    const code = campos[0];
    // Cabeçalho e linha de total não são conta: não têm código com dígito.
    if (!/\d/.test(code) || /^(total|saldo|balance|conta|code)/i.test(code)) { ignored++; continue; }

    let debit = 0, credit = 0;
    if (campos.length >= 4) {
      debit = lerNumero(campos[campos.length - 2]);
      credit = lerNumero(campos[campos.length - 1]);
    } else {
      // Três colunas: a última é saldo com sinal.
      const saldo = lerNumero(campos[campos.length - 1]);
      if (saldo >= 0) debit = saldo; else credit = -saldo;
    }

    // Linha sem valor nenhum não é saldo de abertura; é ruído do relatório.
    if (debit === 0 && credit === 0) { ignored++; continue; }

    rows.push({
      external_code: code,
      external_name: campos.length >= 3 ? campos[1] : "",
      debit, credit, line: i + 1,
    });
  }

  return { rows, ignored };
}

/** Aplica o de-para e separa o que não tem para onde ir. */
export function applyMapping(
  rows: LinhaLida[], mapa: Record<string, string>
): { mapped: LinhaMapeada[]; unmapped: LinhaLida[] } {
  const mapped: LinhaMapeada[] = [];
  const unmapped: LinhaLida[] = [];
  for (const r of rows) {
    const destino = mapa[r.external_code];
    if (destino) mapped.push({ ...r, account_code: destino });
    else unmapped.push(r);
  }
  return { mapped, unmapped };
}

export const somaDebitos = (rows: { debit: number }[]) =>
  Math.round(rows.reduce((s, r) => s + r.debit, 0) * 100) / 100;
export const somaCreditos = (rows: { credit: number }[]) =>
  Math.round(rows.reduce((s, r) => s + r.credit, 0) * 100) / 100;

/**
 * As partidas do lançamento de abertura.
 *
 * Duas contas do plano do cliente podem cair na MESMA conta nossa — é o
 * caso normal quando o plano dele é mais detalhado. Por isso agrupa-se
 * por conta de destino, e o valor é o LÍQUIDO: uma conta que recebeu
 * 1000 de débito e 300 de crédito entra como 700 devedora, não como
 * duas partidas que se anulam parcialmente e sujam o razão.
 */
export function toOpeningLines(mapped: LinhaMapeada[]): {
  account_code: string; debit: number; credit: number; description: string;
}[] {
  const porConta = new Map<string, number>();
  for (const r of mapped) {
    const liquido = Math.round((r.debit - r.credit) * 100);
    porConta.set(r.account_code, (porConta.get(r.account_code) ?? 0) + liquido);
  }
  return Array.from(porConta.entries())
    .filter(([, cents]) => cents !== 0)
    .map(([account_code, cents]) => ({
      account_code,
      debit: cents > 0 ? cents / 100 : 0,
      credit: cents < 0 ? -cents / 100 : 0,
      description: "Saldo de abertura",
    }))
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
}

/**
 * O balancete do cliente fecha?
 *
 * Se não fecha, o problema é do arquivo dele e não da nossa carga —
 * e carregar assim mesmo colocaria a diferença no nosso razão para
 * sempre, atribuída a nós.
 */
export function conferir(rows: LinhaLida[]): {
  debit: number; credit: number; difference: number; ok: boolean;
} {
  const debit = somaDebitos(rows);
  const credit = somaCreditos(rows);
  const difference = Math.round((debit - credit) * 100) / 100;
  return { debit, credit, difference, ok: Math.round(difference * 100) === 0 };
}
