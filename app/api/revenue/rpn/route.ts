import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { denied, requireClient } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";
import { buscarRpns, type Ambiente } from "@/lib/revenue/rpn";
import { credencialParaUsar, guardarRpns, sha512b64 } from "@/lib/revenue/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * IR BUSCAR OS RPN DE UM CLIENTE À REVENUE.
 *
 * Este é o pedido que tem de acontecer ANTES de cada corrida de folha. O RPN é
 * o que diz, por emprego, quantos créditos e que fatia da taxa normal
 * pertencem a este emprego — e para quem tem dois empregos, esses números vêm
 * repartidos pela Revenue e não há como os adivinhar cá.
 *
 * ---------------------------------------------------------------------------
 * PORQUE SE PODE PEDIR SÓ ALGUNS
 *
 * `employeeIds` restringe aos empregos indicados. É como se faz o primeiro
 * ensaio a sério: um cliente, um funcionário, e nada mais — que foi
 * exactamente o pedido. Sem restrição, vem a lista inteira do empregador.
 *
 * ---------------------------------------------------------------------------
 * O QUE VOLTA PARA O ECRÃ
 *
 * A contagem e o que falhou, não os valores fiscais. Os RPN ficam gravados e
 * são lidos por quem calcula, do lado do servidor. O navegador não precisa de
 * ver o crédito anual de ninguém para mostrar "12 de 12 recebidos".
 */

export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  const user = await getSessionUser();
  if (!user?.company_id) return NextResponse.json({ error: "Sem empresa." }, { status: 403 });

  const corpo = await req.json().catch(() => ({}));
  const clientId = String(corpo?.clientId ?? "").trim();
  const ambiente = (corpo?.environment === "production" ? "production" : "test") as Ambiente;
  const ano = Number(corpo?.taxYear) || new Date().getUTCFullYear();
  const employeeIds: string[] = Array.isArray(corpo?.employeeIds) ? corpo.employeeIds : [];

  if (!clientId) return NextResponse.json({ error: "Falta o cliente." }, { status: 400 });
  const acesso = await requireClient(clientId);
  if (denied(acesso)) return acesso.error;

  /*
   * O NÚMERO DE REGISTO DO EMPREGADOR vem do CADASTRO do cliente, e não do
   * corpo do pedido.
   *
   * Deixá-lo vir de fora seria deixar quem chama pedir os RPN de um empregador
   * qualquer usando o certificado do escritório. O acesso ao cliente já foi
   * verificado acima; o empregador tem de sair desse cliente.
   */
  const { data: cliente } = await getServerSupabase()
    .from("clients").select("employer_number,name").eq("id", clientId).maybeSingle();
  const employerReg = String((cliente as any)?.employer_number ?? "").trim();
  if (!employerReg) {
    return NextResponse.json({ error: "semNumeroDeEmpregador", chave: "rev.semEmpregador" }, { status: 409 });
  }

  const cred = await credencialParaUsar(user.company_id, ambiente);
  if (!cred) return NextResponse.json({ error: "semCertificado", chave: "rev.semCertificado" }, { status: 409 });

  const r = await buscarRpns(cred, employerReg, ano, { employeeIds, sha512b64 });
  if (!r.ok) return NextResponse.json({ ok: false, falha: r.falha }, { status: 200 });

  const gravados = await guardarRpns(user.company_id, clientId, employerReg, ano, r.rpns ?? []);

  return NextResponse.json({
    ok: true,
    recebidos: r.rpns?.length ?? 0,
    gravados,
    totalDeclarado: r.total ?? null,
    /*
     * Quem veio SEM RPN é a informação que interessa a seguir.
     *
     * A Revenue devolve o empregado na lista mesmo quando não tem RPN
     * associado — e é para esses que é preciso pedir um RPN novo. Dizê-lo aqui
     * poupa ao contabilista descobri-lo quando o recibo sair em emergência.
     */
    semRpn: (r.rpns ?? []).filter((x) => !x.rpnNumber).map((x) => x.employmentId),
  });
}
