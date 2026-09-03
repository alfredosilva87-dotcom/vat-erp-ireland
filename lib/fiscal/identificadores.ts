/**
 * OS IDENTIFICADORES QUE O SISTEMA ACEITAVA A OLHOS FECHADOS.
 *
 * ---------------------------------------------------------------------------
 * O QUE PASSAVA
 *
 * No cadastro de cliente gravaram-se, sem uma única queixa:
 *
 *     VAT number ............. XXXX
 *     Tax Registration No .... !!!!
 *     Email .................. sem-arroba-nenhum
 *     Phone .................. abcdefgh
 *
 * E no cadastro de funcionário, `XXXX-not-a-pps` no campo do PPS.
 *
 * Nenhum destes é um detalhe de cosmética. O VAT number vai no VAT3 e no RTD
 * entregues à Revenue. O PPS é a chave com que a Revenue identifica a pessoa
 * na submissão PSR — errado, a submissão é rejeitada ou vai para outra pessoa,
 * e o erro só aparece do lado deles, semanas depois. O telefone alimenta os
 * links `wa.me/` da lista, que com letras dão link morto.
 *
 * ---------------------------------------------------------------------------
 * A DECISÃO QUE IMPORTA: AVISAR, NÃO BLOQUEAR
 *
 * Estas funções devolvem um **aviso**, não uma recusa. É deliberado.
 *
 * Um contabilista tem de conseguir gravar um cliente com o VAT ainda por
 * confirmar, ou com o número tal como veio numa fatura estrangeira. Bloquear a
 * gravação transformaria uma ajuda numa parede, e a resposta do escritório
 * seria escrever `IE0000000A` para o ecrã calar — que é pior do que o campo
 * vazio, porque mente.
 *
 * O que se quer é apanhar o **erro de digitação no dia em que acontece**, em
 * vez de no dia da entrega. Para isso um aviso amarelo chega e sobra.
 *
 * ---------------------------------------------------------------------------
 * O DÍGITO DE CONTROLO
 *
 * O VAT irlandês e o PPS partilham a mesma conta: pesos 8..2 sobre os sete
 * dígitos, resto de 23, e o resto indexa a tabela "WABCDEFGHIJKLMNOPQRSTUV".
 * Nos formatos de nove caracteres, a segunda letra entra na soma valendo a sua
 * posição no alfabeto vezes nove.
 *
 * Como é conta e não tabela, um engano de uma tecla é apanhado quase sempre —
 * que é exactamente o erro que se quer apanhar.
 */

export type Aviso = { ok: true } | { ok: false; aviso: string };

const OK: Aviso = { ok: true };
const CHECK_CHARS = "WABCDEFGHIJKLMNOPQRSTUV";

/**
 * O caractere de controlo para sete dígitos, com a segunda letra opcional.
 * Devolve a letra esperada — quem chama compara com a que lá está.
 */
export function caractereDeControlo(seteDigitos: string, segundaLetra?: string): string {
  let soma = 0;
  for (let i = 0; i < 7; i++) soma += Number(seteDigitos[i]) * (8 - i);
  if (segundaLetra) {
    // A → 1, B → 2, … Vale nove vezes a posição, por cima da soma dos dígitos.
    soma += (segundaLetra.toUpperCase().charCodeAt(0) - 64) * 9;
  }
  return CHECK_CHARS[soma % 23];
}

/**
 * Número de VAT irlandês.
 *
 * Formatos aceites (com ou sem o prefixo `IE`):
 *   1234567T    sete dígitos + letra de controlo
 *   1234567FA   sete dígitos + letra de controlo + letra
 *   1S23456L    formato antigo, com `+`, `*` ou letra na segunda posição
 */
export function avisoVatIrlandes(bruto: string | null | undefined): Aviso {
  const s = String(bruto ?? "").toUpperCase().replace(/[\s.-]/g, "");
  if (!s) return OK; // campo vazio é uma escolha, não um erro
  const corpo = s.startsWith("IE") ? s.slice(2) : s;

  // Formato antigo com sinal no meio: normaliza-se para os sete dígitos.
  const antigo = corpo.match(/^(\d)([A-Z+*])(\d{5})([A-Z])$/);
  if (antigo) {
    const [, d1, , resto, check] = antigo;
    const digitos = `${d1}${resto}0`.slice(0, 7); // o sinal não conta; alinha-se à direita
    return caractereDeControlo(`0${d1}${resto}`.slice(0, 7)) === check || caractereDeControlo(digitos) === check
      ? OK
      : { ok: false, aviso: "O dígito de controlo deste VAT não bate. Confirme o número." };
  }

  const m = corpo.match(/^(\d{7})([A-Z])([A-Z])?$/);
  if (!m) {
    return { ok: false, aviso: "Não parece um VAT irlandês. O formato é IE + 7 dígitos + 1 ou 2 letras (ex.: IE1234567T)." };
  }
  const [, digitos, check, segunda] = m;
  return caractereDeControlo(digitos, segunda) === check
    ? OK
    : { ok: false, aviso: "O dígito de controlo deste VAT não bate. Confirme o número." };
}

/**
 * PPS number.
 *
 * Sete dígitos e uma ou duas letras. A segunda letra, quando existe, hoje é
 * quase sempre `A` (ou `W`, no histórico de cônjuges) — mas a conta é a mesma
 * e não vale a pena recusar por causa disso.
 */
export function avisoPps(bruto: string | null | undefined): Aviso {
  const s = String(bruto ?? "").toUpperCase().replace(/[\s.-]/g, "");
  if (!s) return OK;
  const m = s.match(/^(\d{7})([A-Z])([A-Z])?$/);
  if (!m) {
    return { ok: false, aviso: "Não parece um PPS. O formato é 7 dígitos seguidos de 1 ou 2 letras (ex.: 1234567AA)." };
  }
  const [, digitos, check, segunda] = m;
  return caractereDeControlo(digitos, segunda) === check
    ? OK
    : { ok: false, aviso: "O dígito de controlo deste PPS não bate. Confirme o número antes de submeter à Revenue." };
}

/**
 * E-mail — a conta plausível, não a especificação.
 *
 * Validar e-mail a sério é impossível sem lhe mandar uma mensagem. O que se
 * quer aqui é apanhar `sem-arroba-nenhum`, e essa é a fronteira certa.
 */
export function avisoEmail(bruto: string | null | undefined): Aviso {
  const s = String(bruto ?? "").trim();
  if (!s) return OK;
  const plausivel = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s);
  return plausivel ? OK : { ok: false, aviso: "Este e-mail não parece completo — falta o @ ou o domínio." };
}

/**
 * Telefone, para o link de WhatsApp funcionar.
 *
 * O `wa.me/` exige o número em E.164 sem sinais. Um número com letras dá um
 * link que abre e não encontra ninguém — e ninguém repara, porque o link
 * existe.
 */
export function avisoTelefone(bruto: string | null | undefined): Aviso {
  const s = String(bruto ?? "").trim();
  if (!s) return OK;
  if (/[A-Za-z]/.test(s)) return { ok: false, aviso: "O telefone tem letras. O link de WhatsApp só funciona com dígitos." };
  const digitos = s.replace(/\D/g, "");
  if (digitos.length < 7) return { ok: false, aviso: "O telefone parece curto demais." };
  if (digitos.length > 15) return { ok: false, aviso: "O telefone parece comprido demais (o máximo internacional são 15 dígitos)." };
  return OK;
}

/**
 * Põe um telefone irlandês em E.164, que é o que o `wa.me/` quer.
 *
 * `083 838 0361` → `+353838380361`. Um número que já venha com `+` fica como
 * está: pode ser de outro país, e adivinhar seria pior.
 */
export function normalizarTelefone(bruto: string | null | undefined, prefixoPais = "353"): string {
  const s = String(bruto ?? "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return "+" + s.slice(1).replace(/\D/g, "");
  const d = s.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) return "+" + d.slice(2);
  if (d.startsWith(prefixoPais)) return "+" + d;
  // Número nacional irlandês: o zero de tronco cai ao ganhar o indicativo.
  return "+" + prefixoPais + d.replace(/^0/, "");
}
