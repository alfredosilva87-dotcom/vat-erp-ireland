import { criticarFuncionario, ppsValido, type Funcionario } from "./funcionarioPuro";
import { parseAmount } from "../bankStatement";

/**
 * IMPORTAR funcionários e acumulados de outro sistema de folha.
 *
 * ---------------------------------------------------------------------------
 * O PROBLEMA, COMO ELE O PÔS
 *
 * "se eu trocar de ERP, vou precisar subir os dados, e aí como faríamos?
 * precisamos de uma solução rápida e fácil... precisamos garantir que a troca
 * seja segura e confiável."
 *
 * Na Irlanda a troca de pacote de folha faz-se por **CSV** — Sage, BrightPay,
 * Thesaurus e CollSoft exportam e importam CSV. PDF ninguém usa para carregar,
 * só para conferir.
 *
 * ---------------------------------------------------------------------------
 * O QUE TORNA A TROCA SEGURA, E NÃO É A IMPORTAÇÃO
 *
 * É a CONFERÊNCIA. Importar acumulados errados não dá erro nenhum: a primeira
 * folha sai plausível e a diferença aparece meses depois, na conta da Revenue.
 *
 * Por isso o importador não é "ler e gravar". É:
 *
 *   1. ler, sem gravar nada;
 *   2. mostrar linha a linha o que vai acontecer, com o que já existe ao lado;
 *   3. **conferir o acumulado contra o último payslip** — se o CSV disser que
 *      alguém já pagou 1.755,70 de PAYE, o motor tem de chegar ao mesmo número
 *      com o bruto e a semana que o CSV diz. Se não chegar, alguma coluna está
 *      trocada, e isso apanha-se ANTES de gravar;
 *   4. só então gravar.
 *
 * ---------------------------------------------------------------------------
 * O SEPARADOR SAI DO CABEÇALHO, E NÃO DA PRIMEIRA LINHA
 *
 * A demo do Matheus tinha exactamente este defeito, e ele parte com qualquer
 * ficheiro europeu: o Excel em português, espanhol, alemão ou francês grava com
 * `;`, e adivinhar o separador pela primeira linha falha quando essa linha é um
 * título sem separador nenhum. Aqui procura-se a linha que TEM cabeçalhos
 * conhecidos, e é dela que sai o separador.
 */

export type LinhaCrua = Record<string, string>;

/**
 * As colunas que se sabem ler, e os nomes por que elas aparecem.
 *
 * Cada exportador chama-lhes outra coisa, e ninguém vai renomear colunas à mão
 * antes de importar — se for preciso fazer isso, a "solução rápida e fácil"
 * deixa de o ser. Por isso a lista é generosa, e a comparação ignora
 * maiúsculas, acentos, espaços e pontuação.
 */
export const COLUNAS: Record<string, string[]> = {
  first_name: ["first name", "firstname", "forename", "nome", "primeiro nome", "given name"],
  surname: ["surname", "last name", "lastname", "apelido", "sobrenome", "family name"],
  pps_number: ["pps", "pps number", "ppsn", "pps no", "employee pps"],
  employment_id: ["employment id", "employment identifier", "emp id", "employment no"],
  code: ["employee number", "emp number", "emp no", "staff number", "codigo", "employee ref"],
  job_title: ["job title", "position", "role", "funcao", "cargo", "occupation"],
  start_date: ["start date", "date of commencement", "commencement", "data de entrada", "hire date"],
  end_date: ["end date", "date of cessation", "cessation", "leave date", "data de saida"],
  date_of_birth: ["date of birth", "dob", "birth date", "data de nascimento"],
  freq_type: ["frequency", "pay frequency", "block", "bloco", "frequencia"],
  pay_type: ["pay type", "payment type", "tipo de pagamento"],
  hourly_rate: ["hourly rate", "hour rate", "std hour rate", "rate per hour", "taxa hora"],
  sunday_rate: ["sunday rate", "sunday hour rate", "taxa domingo"],
  fixed_amount: ["contract rate", "salary", "gross salary", "periodic salary", "valor do contrato"],
  prsi_class: ["prsi class", "prsi code", "classe prsi"],
  tax_basis: ["tax basis", "basis", "tax status", "tax/usc status", "base"],
  marital_status: ["marital status", "status", "situacao familiar"],
  rpn_cutoff_cents: ["std cut off", "standard cut off", "cut off", "srcop", "yearly cut off"],
  rpn_credits_cents: ["tax credit", "tax credits", "yearly tax credit", "creditos"],
  // --- o acumulado: é isto que faz a troca de sistema ser possível
  ytd_opening_gross_cents: ["gross pay", "ytd gross", "cumulative gross", "gross to date", "bruto acumulado"],
  ytd_opening_paye_cents: ["tax paid", "ytd paye", "paye to date", "cumulative tax", "paye acumulado"],
  ytd_opening_usc_cents: ["usc paid", "ytd usc", "usc to date", "cumulative usc", "usc acumulado"],
  ytd_opening_prsi_cents: ["prsi paid", "ytd prsi", "prsi to date", "cumulative prsi", "prsi acumulado"],
  insurable_weeks: ["total ins wk", "insurable weeks", "ins weeks", "semanas seguraveis"],
};

/** Compara nomes de coluna ignorando o que não distingue nada. */
export const normalizar = (s: string): string =>
  String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const MAPA = new Map<string, string>();
for (const [campo, nomes] of Object.entries(COLUNAS)) {
  for (const n of nomes) MAPA.set(normalizar(n), campo);
}

/**
 * Qual das linhas é o CABEÇALHO, e com que separador.
 *
 * Procura-se a primeira linha que reconheça pelo menos duas colunas conhecidas.
 * Duas e não uma: uma só acerta por acaso num título que contenha a palavra
 * "nome".
 */
export function acharCabecalho(texto: string): { linha: number; sep: string; campos: (string | null)[] } | null {
  const linhas = texto.split(/\r?\n/);
  const SEPS = [",", ";", "\t", "|"];
  for (let i = 0; i < Math.min(linhas.length, 20); i++) {
    if (!linhas[i].trim()) continue;
    for (const sep of SEPS) {
      const celulas = dividir(linhas[i], sep);
      if (celulas.length < 2) continue;
      const campos = celulas.map((c) => MAPA.get(normalizar(c)) ?? null);
      if (campos.filter(Boolean).length >= 2) return { linha: i, sep, campos };
    }
  }
  return null;
}

/** Divide uma linha de CSV respeitando aspas — vírgula dentro de aspas não separa. */
export function dividir(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = "";
  let dentro = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      // Aspa dobrada dentro de aspas é uma aspa literal.
      if (dentro && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentro = !dentro;
    } else if (c === sep && !dentro) { out.push(atual); atual = ""; }
    else atual += c;
  }
  out.push(atual);
  return out.map((s) => s.trim());
}

/**
 * Números como os sistemas os escrevem — e é o MESMO leitor do extrato bancário.
 *
 * `1.234,56` (europeu), `1,234.56` (irlandês), `(45.00)` (negativo contábil),
 * `€ 12,00`, `12.00 DR`. Escrevi um leitor novo aqui e ele falhou logo no
 * `1.234` — que é mil duzentos e trinta e quatro em Portugal e um vírgula dois
 * em Inglaterra. O `lib/bankStatement.ts` já resolvera isso há meses, provado
 * contra ficheiros de bancos a sério.
 *
 * Duas funções para a mesma pergunta são duas funções que divergem: a segunda
 * aprende as excepções que a primeira já sabia, uma de cada vez, à custa de um
 * ficheiro mal lido de cada vez.
 */
export { parseAmount as lerNumero } from "../bankStatement";

const cents = (v: number | null) => (v === null ? null : Math.round(v * 100));
const lerNumero = parseAmount;

/** `W`, `Weekly`, `Semanal`, `Quinzenal`, `M`… → o nosso `freq_type`. */
export function lerFrequencia(bruto: string): string | null {
  const s = normalizar(bruto);
  if (!s) return null;
  if (/^(f|q|b)$|fort|quinz|bi week|biweek|15|2 week/.test(s)) return "fortnightly";
  if (/^m$|month|mensal|mes/.test(s)) return "monthly";
  if (/^w$|week|seman/.test(s)) return "weekly";
  return null;
}

/** `N`/`Normal`/`Cumulative` → cumulativa · `W1`/`Week 1` → semana1 · `E` → emergência. */
export function lerBase(bruto: string): string | null {
  const s = normalizar(bruto);
  if (!s) return null;
  if (/emerg/.test(s)) return "emergencia";
  if (/w1|week 1|month 1|semana 1|non cumul/.test(s)) return "semana1";
  if (/^n$|normal|cumul/.test(s)) return "cumulativa";
  return null;
}

export type LinhaLida = {
  numeroDaLinha: number;
  dados: Funcionario & Record<string, unknown>;
  /** O que impede esta linha de entrar. */
  erro: string | null;
  avisos: string[];
};

export type Leitura = {
  ok: boolean;
  erro?: string;
  /** Colunas do ficheiro que não se souberam ler. Não é erro — é informação. */
  ignoradas: string[];
  reconhecidas: string[];
  linhas: LinhaLida[];
};

export function lerCsv(texto: string, anoDoAcumulado: number): Leitura {
  const cab = acharCabecalho(texto);
  if (!cab) {
    return {
      ok: false, ignoradas: [], reconhecidas: [], linhas: [],
      erro: "Não se encontrou o cabeçalho. Precisa de pelo menos duas colunas conhecidas "
        + "— por exemplo 'First name' e 'PPS'. Separador aceite: vírgula, ponto e vírgula, tabulação ou barra.",
    };
  }

  const linhas = texto.split(/\r?\n/);
  const nomesCrus = dividir(linhas[cab.linha], cab.sep);
  const ignoradas = nomesCrus.filter((_, i) => !cab.campos[i]).filter(Boolean);
  const reconhecidas = cab.campos.filter(Boolean) as string[];

  const lidas: LinhaLida[] = [];
  for (let i = cab.linha + 1; i < linhas.length; i++) {
    if (!linhas[i].trim()) continue;
    const celulas = dividir(linhas[i], cab.sep);
    const bruto: Record<string, string> = {};
    cab.campos.forEach((campo, k) => { if (campo) bruto[campo] = celulas[k] ?? ""; });

    // Linha sem nome nenhum é rodapé de totais, não é pessoa.
    if (!String(bruto.first_name ?? "").trim() && !String(bruto.surname ?? "").trim()) continue;

    const avisos: string[] = [];
    const dados: any = {
      first_name: bruto.first_name ?? "",
      surname: bruto.surname ?? "",
      code: bruto.code || null,
      job_title: bruto.job_title || null,
      pps_number: (bruto.pps_number || "").toUpperCase().replace(/\s/g, "") || null,
      employment_id: bruto.employment_id || null,
      start_date: lerData(bruto.start_date),
      end_date: lerData(bruto.end_date),
      date_of_birth: lerData(bruto.date_of_birth),
      prsi_class: (bruto.prsi_class || "").toUpperCase() || "A1",
      contract_type: "Full time",
      active: true,
    };

    const freq = lerFrequencia(bruto.freq_type ?? "");
    dados.freq_type = freq ?? "weekly";
    if (bruto.freq_type && !freq) {
      avisos.push(`Frequência "${bruto.freq_type}" não reconhecida; ficou semanal.`);
    }

    const hora = cents(lerNumero(bruto.hourly_rate ?? ""));
    const fixo = cents(lerNumero(bruto.fixed_amount ?? ""));
    /*
     * O TIPO DE PAGAMENTO deduz-se do que veio preenchido, e não da coluna.
     *
     * Metade dos exportadores não tem coluna de "pay type": tem taxa horária
     * OU salário, e o tipo lê-se de qual deles está lá. Exigir a coluna
     * rejeitaria ficheiros perfeitamente bons.
     */
    if (hora && hora > 0) {
      dados.pay_type = "Hourly";
      dados.hourly_rate = hora / 100;
      const dom = cents(lerNumero(bruto.sunday_rate ?? ""));
      if (dom) dados.sunday_rate = dom / 100;
    } else if (fixo && fixo > 0) {
      dados.pay_type = dados.freq_type === "monthly" ? "Monthly Fixed"
        : dados.freq_type === "fortnightly" ? "Fortnightly Fixed" : "Weekly Fixed";
      dados.fixed_amount = fixo / 100;
    }

    const base = lerBase(bruto.tax_basis ?? "");
    dados.tax_basis = base ?? "cumulativa";
    if (bruto.tax_basis && !base) {
      avisos.push(`Base "${bruto.tax_basis}" não reconhecida; ficou cumulativa.`);
    }

    dados.rpn_cutoff_cents = cents(lerNumero(bruto.rpn_cutoff_cents ?? ""));
    dados.rpn_credits_cents = cents(lerNumero(bruto.rpn_credits_cents ?? ""));

    const acumulado = {
      gross: cents(lerNumero(bruto.ytd_opening_gross_cents ?? "")),
      paye: cents(lerNumero(bruto.ytd_opening_paye_cents ?? "")),
      usc: cents(lerNumero(bruto.ytd_opening_usc_cents ?? "")),
      prsi: cents(lerNumero(bruto.ytd_opening_prsi_cents ?? "")),
    };
    if (acumulado.gross !== null && acumulado.gross > 0) {
      dados.ytd_opening_gross_cents = acumulado.gross;
      dados.ytd_opening_paye_cents = acumulado.paye ?? 0;
      dados.ytd_opening_usc_cents = acumulado.usc ?? 0;
      dados.ytd_opening_prsi_cents = acumulado.prsi ?? 0;
      dados.ytd_opening_year = anoDoAcumulado;
      /*
       * Bruto acumulado sem imposto acumulado é quase sempre coluna trocada, e
       * é o erro mais caro deste ficheiro: a primeira folha devolve à pessoa o
       * imposto do ano inteiro. Não se recusa — há quem tenha mesmo zero — mas
       * diz-se, alto.
       */
      if (!acumulado.paye) {
        avisos.push(
          "Tem bruto acumulado e PAYE acumulado ZERO. Confirme: se estiver errado, "
            + "a primeira folha devolve a esta pessoa o imposto do ano inteiro."
        );
      }
    } else if (acumulado.paye || acumulado.usc || acumulado.prsi) {
      avisos.push("Tem imposto acumulado mas não tem bruto acumulado. O acumulado foi ignorado.");
    }

    const insWk = lerNumero(bruto.insurable_weeks ?? "");
    if (insWk !== null) dados.insurable_weeks = Math.round(insWk);

    const critica = criticarFuncionario(dados);
    lidas.push({
      numeroDaLinha: i + 1,
      dados: critica.ok ? critica.limpo : dados,
      erro: critica.ok ? null : critica.erro,
      avisos: [...avisos, ...(critica.ok ? critica.avisos : [])],
    });
  }

  return { ok: true, ignoradas, reconhecidas, linhas: lidas };
}

/** `31/12/2026`, `2026-12-31`, `31-Dec-2026`. Devolve ISO, ou `null`. */
export function lerData(bruto: string): string | null {
  const s = String(bruto ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const MESES: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  let m = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/.exec(s);
  if (m) {
    const mes = MESES[m[2].slice(0, 3).toLowerCase()];
    if (mes) return `${m[3]}-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  /*
   * `dd/mm/yyyy` e nunca `mm/dd/yyyy`.
   *
   * A Irlanda escreve dia primeiro, e adivinhar pelo valor (">12 logo é dia")
   * acerta em 03/04 metade das vezes — que é o mesmo que errar metade das
   * vezes, numa data de admissão que decide semanas de acumulado.
   */
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export { ppsValido };
