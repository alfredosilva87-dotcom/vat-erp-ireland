import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { buscarRpns, type Ambiente } from "@/lib/revenue/rpn";
import { credencialParaUsar, registarTeste, sha512b64 } from "@/lib/revenue/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Um pedido ao ROS pode demorar; melhor esperar do que devolver um erro que
// parece da Revenue e é nosso.
export const maxDuration = 60;

/**
 * TESTAR A LIGAÇÃO — antes de alguém correr uma folha a sério.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ISTO EXISTE COMO BOTÃO PRÓPRIO
 *
 * O pedido que este botão faz é o mesmo que a folha faria: mesma assinatura,
 * mesmo certificado, mesmo ambiente, mesmo endpoint. A diferença é o momento —
 * aqui é de propósito, com alguém a olhar, e sem nada dependente do resultado.
 *
 * Sem ele, a primeira prova de que o certificado funciona seria uma folha a
 * meio, na semana do pagamento. Um `401` nessa altura é uma crise; aqui é uma
 * linha vermelha num ecrã de configuração.
 *
 * ---------------------------------------------------------------------------
 * PORQUE UM RPN E NÃO UM "ping"
 *
 * Não há endpoint de saúde. E mesmo que houvesse, não provaria o que interessa:
 * o que se quer saber é se ESTE certificado, com ESTE TAIN, tem autorização
 * para ver os dados DESTE empregador. Só o pedido a sério responde a isso.
 *
 * Um `GET` de RPN não muda nada do lado deles — é leitura pura. É o pedido mais
 * seguro que existe para fazer esta pergunta.
 */

export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  const user = await getSessionUser();
  if (!user?.company_id) return NextResponse.json({ error: "Sem empresa." }, { status: 403 });

  const corpo = await req.json().catch(() => ({}));
  const ambiente = (corpo?.environment === "production" ? "production" : "test") as Ambiente;
  const employerReg = String(corpo?.employerRegistrationNumber ?? "").trim();
  const ano = Number(corpo?.taxYear) || new Date().getUTCFullYear();
  const employeeIds: string[] = Array.isArray(corpo?.employeeIds) ? corpo.employeeIds.slice(0, 5) : [];

  if (!employerReg) {
    return NextResponse.json({ error: "Falta o número de registo do empregador." }, { status: 400 });
  }

  const cred = await credencialParaUsar(user.company_id, ambiente);
  if (!cred) {
    return NextResponse.json({ error: "semCertificado", chave: "rev.semCertificado" }, { status: 409 });
  }

  const r = await buscarRpns(cred, employerReg, ano, { employeeIds, sha512b64 });

  /*
   * O resultado fica GRAVADO na credencial.
   *
   * Quem chega a este ecrã amanhã tem de poder ver que ele já foi testado, e
   * quando — sem repetir o pedido. É a diferença entre "acho que está" e
   * "esteve, às 14:32 de terça, e respondeu 3 RPN".
   */
  const mensagem = r.ok
    ? `${r.rpns?.length ?? 0} RPN recebido(s) para ${employerReg} / ${ano}.`
    : `${r.falha?.codigo}${r.falha?.status ? ` (HTTP ${r.falha.status})` : ""}`;
  await registarTeste(user.company_id, ambiente, Boolean(r.ok), mensagem);

  if (!r.ok) {
    return NextResponse.json({ ok: false, falha: r.falha }, { status: 200 });
  }

  /*
   * Devolve o RESUMO, não os RPN.
   *
   * Um RPN traz o PPS e os valores fiscais de uma pessoa concreta. Um botão de
   * "testar ligação" não precisa disso para provar o que veio provar, e mandar
   * dados fiscais para o navegador só porque estavam à mão é como se espalham
   * dados pessoais sem ninguém decidir espalhá-los.
   */
  return NextResponse.json({
    ok: true,
    recebidos: r.rpns?.length ?? 0,
    totalDeclarado: r.total ?? null,
    ambiente,
    employerReg,
    ano,
  });
}
