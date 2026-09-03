/**
 * O QUE FICA GUARDADO DA LIGAÇÃO AO ROS.
 *
 * Duas coisas, e só duas: a credencial do escritório (uma por empresa e por
 * ambiente) e os RPN que a Revenue devolveu.
 *
 * A chave privada entra e sai daqui SEMPRE cifrada — o único sítio do produto
 * onde ela existe em claro é dentro da função que assina, e por microssegundos.
 * Ver ./cofre.ts para o porquê de a senha do `.p12` nunca ser guardada.
 */

import { createHash, createSign } from "crypto";
import { getServerSupabase } from "@/lib/supabase";
import { cifrar, decifrar, impressaoDigital } from "./cofre";
import type { Ambiente, Credencial, Rpn } from "./rpn";

const sb = () => getServerSupabase();

/** SHA-512 em base64 — o que o cabeçalho `Digest` do POST precisa. */
export const sha512b64 = (dados: string) =>
  createHash("sha512").update(dados, "utf8").digest("base64");

export interface CredencialGuardada {
  id: string;
  ambiente: Ambiente;
  agentTain: string | null;
  certificadoBase64: string;
  titular: string | null;
  emissor: string | null;
  impressao: string;
  validoDe: string | null;
  validoAte: string | null;
  ultimoTesteEm: string | null;
  ultimoTesteOk: boolean | null;
  ultimoTesteMensagem: string | null;
}

/** O que o ecrã pode mostrar. Nunca a chave. */
export async function lerCredenciais(companyId: string): Promise<CredencialGuardada[]> {
  const { data } = await sb()
    .from("revenue_credentials")
    .select("id,environment,agent_tain,certificate_b64,subject,issuer,fingerprint,valid_from,valid_to,last_test_at,last_test_ok,last_test_message")
    .eq("company_id", companyId)
    .order("environment");
  return (data ?? []).map((r: any) => ({
    id: r.id,
    ambiente: r.environment,
    agentTain: r.agent_tain,
    certificadoBase64: r.certificate_b64,
    titular: r.subject,
    emissor: r.issuer,
    impressao: r.fingerprint,
    validoDe: r.valid_from,
    validoAte: r.valid_to,
    ultimoTesteEm: r.last_test_at,
    ultimoTesteOk: r.last_test_ok,
    ultimoTesteMensagem: r.last_test_message,
  }));
}

export async function guardarCredencial(entrada: {
  companyId: string;
  ambiente: Ambiente;
  agentTain: string | null;
  certificadoBase64: string;
  chavePrivadaPem: string;
  titular: string;
  emissor: string;
  validoDe: string;
  validoAte: string;
  porQuem: string | null;
}): Promise<void> {
  await sb().from("revenue_credentials").upsert(
    {
      company_id: entrada.companyId,
      environment: entrada.ambiente,
      agent_tain: entrada.agentTain,
      certificate_b64: entrada.certificadoBase64,
      // Cifrada. Se `REVENUE_CERT_KEY` faltar, isto rebenta aqui — de propósito,
      // para nunca haver o caso "guardou em claro e ninguém deu por isso".
      private_key_enc: cifrar(entrada.chavePrivadaPem),
      subject: entrada.titular,
      issuer: entrada.emissor,
      fingerprint: impressaoDigital(entrada.certificadoBase64),
      valid_from: entrada.validoDe,
      valid_to: entrada.validoAte,
      // Um certificado novo ainda não foi testado — e dizer o contrário seria
      // mentir no ecrã que existe justamente para dar confiança.
      last_test_at: null,
      last_test_ok: null,
      last_test_message: null,
      uploaded_by: entrada.porQuem,
    },
    { onConflict: "company_id,environment" }
  );
}

export async function apagarCredencial(companyId: string, ambiente: Ambiente): Promise<void> {
  await sb().from("revenue_credentials").delete()
    .eq("company_id", companyId).eq("environment", ambiente);
}

/**
 * Monta a credencial VIVA — a que sabe assinar.
 *
 * A chave é decifrada aqui e fica presa dentro do `assinar`. Não é devolvida,
 * não é registada, e não passa por nenhuma rota.
 */
export async function credencialParaUsar(
  companyId: string, ambiente: Ambiente
): Promise<Credencial | null> {
  const { data } = await sb()
    .from("revenue_credentials")
    .select("certificate_b64,private_key_enc,agent_tain")
    .eq("company_id", companyId).eq("environment", ambiente)
    .maybeSingle();
  if (!data) return null;

  const pem = decifrar((data as any).private_key_enc);
  return {
    ambiente,
    certificadoBase64: (data as any).certificate_b64,
    agentTain: (data as any).agent_tain ?? null,
    assinar: (s: string) => {
      const sig = createSign("RSA-SHA512");
      sig.update(s, "utf8");
      return sig.sign(pem, "base64");
    },
  };
}

/** Regista o resultado do "testar ligação", para o ecrã não ter de adivinhar. */
export async function registarTeste(
  companyId: string, ambiente: Ambiente, ok: boolean, mensagem: string
): Promise<void> {
  await sb().from("revenue_credentials")
    .update({ last_test_at: new Date().toISOString(), last_test_ok: ok, last_test_message: mensagem.slice(0, 400) })
    .eq("company_id", companyId).eq("environment", ambiente);
}

/**
 * Guarda os RPN recebidos.
 *
 * `upsert` pela chave natural (empresa, empregador, ano, PPS, emprego): um RPN
 * novo SUBSTITUI o anterior daquele emprego, que é exactamente o que a Revenue
 * quer dizer quando emite um `rpnNumber` maior. A resposta crua fica em `raw`
 * para se poder responder "porque é que o desconto mudou?".
 */
export async function guardarRpns(
  companyId: string, clientId: string | null, employerReg: string, taxYear: number, rpns: Rpn[]
): Promise<number> {
  if (!rpns.length) return 0;
  const linhas = rpns.map((r) => ({
    company_id: companyId,
    client_id: clientId,
    employer_reg: employerReg,
    tax_year: taxYear,
    employee_ppsn: r.ppsn,
    employment_id: r.employmentId,
    rpn_number: r.rpnNumber,
    rpn_issue_date: r.emitidoEm,
    effective_date: r.efectivoDe,
    end_date: r.efectivoAte,
    calculation_basis: r.base,
    yearly_tax_credits: r.creditosAnuais,
    yearly_cut_off: r.cutOffAnual,
    pay_tax_to_date: r.pagoParaImpostoAteAgora,
    tax_deducted_to_date: r.impostoDescontadoAteAgora,
    pay_usc_to_date: r.pagoParaUscAteAgora,
    usc_deducted_to_date: r.uscDescontadoAteAgora,
    lpt_to_deduct: r.lptADescontar,
    usc_status: r.uscStatus,
    usc_rates: r.uscRates as any,
    tax_rates: r.taxRates as any,
    raw: r.bruto as any,
    fetched_at: new Date().toISOString(),
  }));
  const { error } = await sb().from("revenue_rpn").upsert(linhas, {
    onConflict: "company_id,employer_reg,tax_year,employee_ppsn,employment_id",
  });
  return error ? 0 : linhas.length;
}

/**
 * O RPN de um funcionário, para o motor da folha.
 *
 * Devolve nulo quando não há — e o motor já sabe o que fazer com isso: usa o
 * palpite do cadastro e marca o recibo com `aviso.semRpn`. Um recibo calculado
 * sem RPN não é inválido; é um recibo que diz que foi calculado sem RPN.
 */
export async function rpnDoFuncionario(
  companyId: string, employerReg: string, taxYear: number, ppsn: string, employmentId: string
) {
  const { data } = await sb()
    .from("revenue_rpn")
    .select("*")
    .eq("company_id", companyId).eq("employer_reg", employerReg).eq("tax_year", taxYear)
    .eq("employee_ppsn", ppsn).eq("employment_id", employmentId)
    .maybeSingle();
  return data ?? null;
}
