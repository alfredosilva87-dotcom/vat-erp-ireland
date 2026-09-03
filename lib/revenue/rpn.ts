/**
 * O CLIENTE DO RPN — ir buscar à Revenue o que decide o desconto.
 *
 * ---------------------------------------------------------------------------
 * O QUE É UM RPN, E PORQUE NÃO SE CALCULA CÁ
 *
 * O RPN (Revenue Payroll Notification) é o que a Revenue emite POR EMPREGO. Diz
 * quantos créditos anuais e que fatia da taxa normal (o *cut-off*) pertencem a
 * este emprego, em que base opera, e o que já foi pago e descontado no ano.
 *
 * Quem tem dois empregos tem os créditos REPARTIDOS entre eles pela Revenue, e
 * nenhum dos dois empregadores sabe o que o outro está a usar. Por isso não há
 * como acertar isto localmente: o único número certo é o que eles mandam. É
 * literalmente a razão de o RPN existir.
 *
 * ---------------------------------------------------------------------------
 * OS PONTOS DE ENTRADA, VERBATIM DO GUIA
 *
 *   GET {base}/paye-employers/v1/rest/rpn/{employerRegistrationNumber}/{taxYear}
 *   GET {base}/paye-employers/v1/rest/rpn/{employerRegistrationNumber}/{taxYear}/{employeeId}
 *
 * com `softwareUsed`, `softwareVersion` e, para um escritório a submeter por um
 * cliente, `agentTain`.
 *
 * ---------------------------------------------------------------------------
 * PORQUE METADE DESTE FICHEIRO É TRADUÇÃO DE ERROS
 *
 * A Revenue responde por código HTTP e pouco mais. Um `401` pode ser o
 * certificado errado, a assinatura mal construída, ou o relógio da máquina
 * fora da janela de 90 minutos — três problemas com três soluções diferentes, e
 * o mesmo número.
 *
 * Deixar isso chegar cru ao contabilista é garantir que, no dia em que falhar,
 * a resposta seja "não funciona". Aqui traduz-se para o gesto seguinte.
 */

import { montarCabecalhos, agoraParaRevenue, dentroDaJanela, type Assinador, type Sha512Base64 } from "./assinatura";

/** Os dois ambientes. Trocar um pelo outro é como se submete a sério por engano. */
export const HOSTS = {
  test: "softwaretestnextversion.ros.ie",
  production: "www.ros.ie",
} as const;
export type Ambiente = keyof typeof HOSTS;

export const CAMINHO_BASE = "/paye-employers/v1/rest";

/** Como nos identificamos à Revenue. Vai em todos os pedidos. */
export const SOFTWARE = { usado: "ACCENTRA", versao: "1.0" };

export interface Credencial {
  ambiente: Ambiente;
  certificadoBase64: string;
  /** Assina com a chave privada. Ela não passa por este módulo. */
  assinar: Assinador;
  /** O TAIN do escritório, quando age como agente. */
  agentTain?: string | null;
}

/** Um RPN, já em cêntimos e com os nomes do nosso lado. */
export interface Rpn {
  ppsn: string;
  employmentId: string;
  rpnNumber: string | null;
  emitidoEm: string | null;
  efectivoDe: string | null;
  efectivoAte: string | null;
  /** `CUMULATIVE` | `WEEK1` | `EMERGENCY`, como a Revenue o escreve. */
  base: string | null;
  creditosAnuais: number | null;
  cutOffAnual: number | null;
  pagoParaImpostoAteAgora: number | null;
  impostoDescontadoAteAgora: number | null;
  pagoParaUscAteAgora: number | null;
  uscDescontadoAteAgora: number | null;
  lptADescontar: number | null;
  uscStatus: string | null;
  uscRates: unknown;
  taxRates: unknown;
  bruto: unknown;
}

/** Euros com decimais → cêntimos. O módulo de folha inteiro fala cêntimos. */
export function aCentimos(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Traduz a resposta da Revenue para o nosso lado.
 *
 * Nomes deles à esquerda, nossos à direita, num sítio só — para o dia em que
 * eles mudarem um campo, haver UM ficheiro para corrigir.
 */
export function lerRpn(r: any): Rpn {
  const escalao = (lista: any[], i: number) => (Array.isArray(lista) ? lista.find((x) => x?.index === i) : undefined);
  return {
    ppsn: String(r?.employeeID?.employeePpsn ?? ""),
    employmentId: String(r?.employeeID?.employmentID ?? ""),
    rpnNumber: r?.rpnNumber != null ? String(r.rpnNumber) : null,
    emitidoEm: r?.rpnIssueDate ?? null,
    efectivoDe: r?.effectiveDate ?? null,
    efectivoAte: r?.endDate ?? null,
    base: r?.incomeTaxCalculationBasis ?? null,
    creditosAnuais: aCentimos(r?.yearlyTaxCredits),
    // O cut-off que interessa é o do PRIMEIRO escalão: é até onde se paga à
    // taxa normal. O segundo escalão não traz cut-off porque não tem tecto.
    cutOffAnual: aCentimos(escalao(r?.taxRates, 1)?.yearlyRateCutOff),
    pagoParaImpostoAteAgora: aCentimos(r?.payForIncomeTaxToDate),
    impostoDescontadoAteAgora: aCentimos(r?.incomeTaxDeductedToDate),
    pagoParaUscAteAgora: aCentimos(r?.payForUSCToDate),
    uscDescontadoAteAgora: aCentimos(r?.uscDeductedToDate),
    lptADescontar: aCentimos(r?.lptToDeduct),
    uscStatus: r?.uscStatus ?? null,
    uscRates: r?.uscRates ?? null,
    taxRates: r?.taxRates ?? null,
    bruto: r,
  };
}

/** O que corre mal, dito de forma a que o passo seguinte seja óbvio. */
export type FalhaRevenue = {
  codigo:
    | "semCertificado" | "assinaturaRecusada" | "semAutorizacao" | "pedidoInvalido"
    | "naoEncontrado" | "indisponivel" | "relogio" | "rede" | "respostaEstranha";
  /** Chave de tradução para o ecrã. */
  chave: string;
  /** O estado HTTP, quando houve um. Para o registo, não para o ecrã. */
  status?: number;
  detalhe?: string;
};

export function traduzirFalha(status: number, corpo?: string): FalhaRevenue {
  if (status === 401) {
    return {
      codigo: "assinaturaRecusada", status, detalhe: corpo,
      chave: "rev.err401",
    };
  }
  if (status === 403) return { codigo: "semAutorizacao", status, detalhe: corpo, chave: "rev.err403" };
  if (status === 400) return { codigo: "pedidoInvalido", status, detalhe: corpo, chave: "rev.err400" };
  if (status === 404) return { codigo: "naoEncontrado", status, detalhe: corpo, chave: "rev.err404" };
  if (status >= 500) return { codigo: "indisponivel", status, detalhe: corpo, chave: "rev.err500" };
  return { codigo: "respostaEstranha", status, detalhe: corpo, chave: "rev.errOutro" };
}

export interface Resultado {
  ok: boolean;
  rpns?: Rpn[];
  /** Quantos a Revenue diz ter, para se conferir contra o que chegou. */
  total?: number;
  falha?: FalhaRevenue;
}

/**
 * Vai buscar os RPN de um empregador.
 *
 * `employeeIds` opcional restringe aos empregos indicados — é o que se usa para
 * o ensaio pedido: um cliente, um funcionário, e nada mais.
 */
export async function buscarRpns(
  cred: Credencial,
  employerReg: string,
  taxYear: number,
  opcoes: { employeeIds?: string[]; sha512b64?: Sha512Base64; fetchImpl?: typeof fetch } = {}
): Promise<Resultado> {
  const host = HOSTS[cred.ambiente];
  const qs = new URLSearchParams({
    softwareUsed: SOFTWARE.usado,
    softwareVersion: SOFTWARE.versao,
  });
  if (cred.agentTain) qs.set("agentTain", cred.agentTain);
  for (const id of opcoes.employeeIds ?? []) qs.append("employeeIDs", id);

  const caminho = `${CAMINHO_BASE}/rpn/${encodeURIComponent(employerReg)}/${taxYear}?${qs.toString()}`;
  const data = agoraParaRevenue();

  /*
   * O relógio, ANTES de gastar um pedido.
   *
   * A janela é de 90 minutos e a máquina pode estar fora dela — num servidor
   * mal sincronizado, ou depois de uma suspensão. A Revenue responderia 401, o
   * mesmo código de uma assinatura errada, e mandaria toda a gente à procura do
   * certificado quando o problema é a hora. Isto apanha-o antes.
   */
  if (!dentroDaJanela(data)) {
    return { ok: false, falha: { codigo: "relogio", chave: "rev.errRelogio" } };
  }

  const headers = montarCabecalhos(
    { metodo: "GET", caminho, host, data },
    cred.certificadoBase64,
    cred.assinar,
    opcoes.sha512b64
  );

  const f = opcoes.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`https://${host}${caminho}`, {
      method: "GET",
      headers: { ...headers, Accept: "application/json" } as any,
      cache: "no-store",
    });
  } catch (e: any) {
    return { ok: false, falha: { codigo: "rede", chave: "rev.errRede", detalhe: String(e?.message ?? e) } };
  }

  const texto = await res.text().catch(() => "");
  if (!res.ok) return { ok: false, falha: traduzirFalha(res.status, texto.slice(0, 400)) };

  let corpo: any;
  try { corpo = JSON.parse(texto); }
  catch { return { ok: false, falha: { codigo: "respostaEstranha", chave: "rev.errOutro", detalhe: texto.slice(0, 200) } }; }

  const lista = Array.isArray(corpo?.rpns) ? corpo.rpns : [];
  return { ok: true, rpns: lista.map(lerRpn), total: Number(corpo?.totalRPNCount ?? lista.length) };
}
