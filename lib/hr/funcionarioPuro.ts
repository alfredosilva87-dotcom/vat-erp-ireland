/**
 * O que faz de um funcionário um cadastro válido — sem banco, para ser testado.
 *
 * ---------------------------------------------------------------------------
 * A LACUNA QUE ISTO FECHA
 *
 * Até aqui o módulo de RH só LIA funcionários: não havia rota nem tela para
 * criar ou editar nenhum. Quem semeava era SQL directo, e enquanto foi assim o
 * escritório não conseguia admitir ninguém.
 *
 * ---------------------------------------------------------------------------
 * AS INVARIANTES QUE NÃO SE PODEM QUEBRAR
 *
 * Duas vêm do desenho do Matheus e são a melhor decisão do sistema dele:
 *
 *   **`pay_type` tem de casar com `freq_type`.** Não existe alguém "mensal"
 *   com contrato semanal. Deixar as duas soltas produzia um rateio absurdo que
 *   ninguém apanhava até ver o líquido.
 *
 *   **Taxa horária e valor de contrato excluem-se.** Guardar os dois deixa a
 *   pergunta "qual manda?" para o momento do cálculo, e a resposta muda
 *   conforme quem lê.
 *
 * A terceira é nossa, e vem do imposto: **quem está em base cumulativa e tem
 * acumulado de abertura precisa de dizer a que ANO ele pertence** — senão o
 * acumulado de 2025 entra na folha de 2026 e a pessoa leva um ano inteiro de
 * imposto devolvido de uma vez.
 */

export type FreqType = "weekly" | "fortnightly" | "monthly";
export type PayType = "Hourly" | "Weekly Fixed" | "Fortnightly Fixed" | "Monthly Fixed";

/** O `pay_type` fixo que cada frequência aceita. Horário serve todas. */
export const FIXO_DE: Record<FreqType, PayType> = {
  weekly: "Weekly Fixed",
  fortnightly: "Fortnightly Fixed",
  monthly: "Monthly Fixed",
};

export const payTypesDe = (f: FreqType): PayType[] => ["Hourly", FIXO_DE[f]];

export type Funcionario = {
  first_name?: string | null;
  surname?: string | null;
  freq_type?: string | null;
  pay_type?: string | null;
  contract_type?: string | null;
  hourly_rate?: number | string | null;
  sunday_rate?: number | string | null;
  fixed_amount?: number | string | null;
  start_date?: string | null;
  end_date?: string | null;
  pps_number?: string | null;
  tax_basis?: string | null;
  marital_status?: string | null;
  prsi_class?: string | null;
  rpn_cutoff_cents?: number | null;
  rpn_credits_cents?: number | null;
  ytd_opening_gross_cents?: number | null;
  ytd_opening_year?: number | null;
  date_of_birth?: string | null;
  ae_enrolled?: boolean | null;
  ae_opt_out_date?: string | null;
  has_occupational_pension?: boolean | null;
  [k: string]: unknown;
};

export type Critica = { ok: true; limpo: Funcionario; avisos: string[] } | { ok: false; erro: string };

const texto = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * O PPS irlandês: 7 dígitos + letra de controlo + uma segunda letra opcional.
 *
 * O dígito de controlo é um módulo 23 com pesos 8..2 — a mesma ideia do NIF
 * português ou do IBAN. Vale a pena conferir aqui porque um PPS trocado num
 * dígito **não dá erro nenhum** neste sistema: dá erro meses depois, na
 * Revenue, quando a submissão é recusada ou — pior — aceite contra a pessoa
 * errada.
 *
 * A segunda letra (o "W" histórico das mulheres casadas, e os A/B de casos
 * especiais) NÃO entra no cálculo.
 */
export function ppsValido(bruto: string): boolean {
  const s = bruto.toUpperCase().replace(/\s/g, "");
  const m = /^(\d{7})([A-W])([A-IW]?)$/.exec(s);
  if (!m) return false;
  const [, digitos, controlo, segunda] = m;

  let soma = 0;
  for (let i = 0; i < 7; i++) soma += Number(digitos[i]) * (8 - i);
  // A segunda letra entra como posição 9 com peso 9: A=1 … I=9, W=0.
  if (segunda && segunda !== "W") soma += (segunda.charCodeAt(0) - 64) * 9;

  const resto = soma % 23;
  // Resto 0 é "W"; 1..22 são A..V.
  const esperado = resto === 0 ? "W" : String.fromCharCode(64 + resto);
  return controlo === esperado;
}

export function criticarFuncionario(f: Funcionario): Critica {
  const avisos: string[] = [];

  const nome = texto(f.first_name);
  if (!nome) return { ok: false, erro: "O primeiro nome e obrigatorio." };

  const freq = texto(f.freq_type) as FreqType;
  if (!["weekly", "fortnightly", "monthly"].includes(freq)) {
    return { ok: false, erro: "Escolha o bloco de payslip: semanal, quinzenal ou mensal." };
  }

  const pay = texto(f.pay_type) as PayType;
  const permitidos = payTypesDe(freq);
  if (!permitidos.includes(pay)) {
    return {
      ok: false,
      erro: `No bloco ${freq} o tipo de pagamento so pode ser ${permitidos.join(" ou ")}. `
        + `Veio "${pay || "(vazio)"}".`,
    };
  }

  const horario = pay === "Hourly";
  const taxa = num(f.hourly_rate);
  const domingo = num(f.sunday_rate);
  const fixo = num(f.fixed_amount);

  if (horario && taxa <= 0) {
    return { ok: false, erro: "Pagamento a hora sem taxa horaria: o bruto sairia sempre zero." };
  }
  if (!horario && fixo <= 0) {
    return { ok: false, erro: "Contrato fixo sem valor: o bruto sairia sempre zero." };
  }
  if (horario && domingo > 0 && domingo < taxa) {
    // Não é erro — há quem pague domingo igual — mas quase sempre é engano de
    // digitação, e um domingo mais barato que um dia útil merece uma pergunta.
    avisos.push("A taxa de domingo e MENOR que a normal. Confirme que e mesmo assim.");
  }

  const inicio = texto(f.start_date);
  const fim = texto(f.end_date);
  if (inicio && fim && fim < inicio) {
    return { ok: false, erro: "A data de saida e anterior a de entrada." };
  }

  const pps = texto(f.pps_number).toUpperCase().replace(/\s/g, "");
  if (pps && !ppsValido(pps)) {
    return {
      ok: false,
      erro: `O PPS ${pps} nao passa no digito de controlo. Um PPS trocado num digito nao da erro aqui `
        + "— da na Revenue, meses depois, e pode ir contra a pessoa errada.",
    };
  }
  if (!pps) {
    avisos.push("Sem PPS nao ha submissao a Revenue nem RPN. A folha calcula, mas nao se entrega.");
  }

  const base = texto(f.tax_basis) || "cumulativa";
  if (!["cumulativa", "semana1", "emergencia"].includes(base)) {
    return { ok: false, erro: `Base de tributacao desconhecida: "${base}".` };
  }
  if (base === "emergencia") {
    avisos.push("Base de EMERGENCIA: retem-se muito mais, de proposito. Peca o RPN a Revenue.");
  }

  const marital = texto(f.marital_status) || "solteiro";
  if (!["solteiro", "familiaMonoparental", "casadoUmSalario", "casadoDoisSalarios"].includes(marital)) {
    return { ok: false, erro: `Situacao familiar desconhecida: "${marital}".` };
  }

  /*
   * O ACUMULADO DE ABERTURA sem ANO é a armadilha que apanha quem migra do
   * CollSoft a meio do ano: o acumulado de 2025 entrava na folha de 2026, e a
   * pessoa levava um ano inteiro de imposto devolvido de uma só vez. O número
   * sai plausível e a devolução é enorme.
   */
  const abertura = Number(f.ytd_opening_gross_cents ?? 0);
  const anoAbertura = f.ytd_opening_year;
  if (abertura > 0 && !anoAbertura) {
    return {
      ok: false,
      erro: "Ha acumulado de abertura mas nao se disse a que ANO pertence. "
        + "Sem isso ele entraria na folha do ano errado.",
    };
  }
  if (abertura > 0 && base !== "cumulativa") {
    avisos.push(
      "O acumulado de abertura so e usado na base cumulativa; nesta base vai ser ignorado."
    );
  }

  /*
   * AUTO-ENROLMENT: a decisao e tri-estado, e as datas vazias tem de virar
   * nulas.
   *
   * `""` numa coluna `date` do Postgres nao e "vazio", e um erro de sintaxe —
   * e o formulario manda string vazia sempre que o campo nao foi tocado. As
   * outras duas datas (`start_date`, `end_date`) ja passavam por aqui; estas
   * duas chegaram depois e teriam ido cruas.
   */
  const nascimento = texto(f.date_of_birth);
  const optOut = texto(f.ae_opt_out_date);
  // O `""` vem do <select> vazio do formulario, e nao e "false": e "ainda nao
  // se decidiu". Distingui-los e a razao de o campo ser tri-estado.
  const inscrito = f.ae_enrolled === null || f.ae_enrolled === undefined
    || (f.ae_enrolled as unknown) === "" ? null : !!f.ae_enrolled;
  if (inscrito === null && !nascimento) {
    // Nao e erro: e o estado normal de quem entrou hoje. Mas sem data de
    // nascimento o teste da lei nao se consegue aplicar, e a folha decide sem
    // saber a idade.
    avisos.push(
      "Sem data de nascimento a folha nao consegue aplicar o teste de idade do "
      + "auto-enrolment (23 a 60). Preencha-a, ou decida a inscricao a mao."
    );
  }

  const limpo: Funcionario = {
    ...f,
    date_of_birth: nascimento || null,
    ae_enrolled: inscrito,
    // Uma data de saida sem saida e lixo que fica no registo a contradizer o
    // estado: so se guarda quando alguem DECIDIU sair.
    ae_opt_out_date: inscrito === false ? (optOut || null) : null,
    has_occupational_pension: !!f.has_occupational_pension,
    first_name: nome,
    surname: texto(f.surname) || null,
    freq_type: freq,
    pay_type: pay,
    // O lado que não se aplica é LIMPO, e não deixado a zero: um campo a zero
    // parece preenchido e reabre a pergunta "qual manda?".
    hourly_rate: horario ? taxa : null,
    sunday_rate: horario ? (domingo || null) : null,
    fixed_amount: horario ? null : fixo,
    start_date: inicio || null,
    end_date: fim || null,
    pps_number: pps || null,
    tax_basis: base,
    marital_status: marital,
    prsi_class: texto(f.prsi_class) || "A1",
    ytd_opening_year: abertura > 0 ? Number(anoAbertura) : (anoAbertura ? Number(anoAbertura) : null),
  };

  return { ok: true, limpo, avisos };
}
