import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { abrirP12, diasAteExpirar } from "@/lib/revenue/certificado";
import { cofreConfigurado } from "@/lib/revenue/cofre";
import { guardarCredencial, lerCredenciais, apagarCredencial } from "@/lib/revenue/store";
import type { Ambiente } from "@/lib/revenue/rpn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O CERTIFICADO DO ROS ENTRA POR AQUI — e não por uma variável de ambiente.
 *
 * A escolha é deliberada e foi pedida assim: quem instala o ERP no escritório
 * não vai editar ficheiros de configuração num servidor. O ficheiro `.p12` que
 * o ROS entrega chega por este ecrã, a senha abre-o uma vez, e o que fica
 * guardado é a chave já extraída e cifrada.
 *
 * ---------------------------------------------------------------------------
 * A SENHA NÃO É GUARDADA, E NÃO É REGISTADA
 *
 * Ela existe dentro desta função e mais nada. Não vai para a base de dados, não
 * vai para nenhum log, e não volta em nenhuma resposta. Se alguém precisar de a
 * repetir um dia, importa o ficheiro outra vez — que é o comportamento certo,
 * porque significa que ninguém a pode ir buscar aqui.
 *
 * ---------------------------------------------------------------------------
 * SÓ ADMINISTRADOR
 *
 * Este é o certificado com que o escritório fala à Revenue em nome dos clientes
 * dele. Não é uma definição — é a credencial.
 */

const ehAmbiente = (v: string): v is Ambiente => v === "test" || v === "production";

export async function GET() {
  const user = await getSessionUser();
  if (!user?.company_id) return NextResponse.json({ error: "Sem empresa." }, { status: 403 });

  const creds = await lerCredenciais(user.company_id);
  return NextResponse.json({
    // A tela precisa de saber isto ANTES de deixar tentar, para poder explicar
    // em vez de falhar a meio de um upload.
    cofrePronto: cofreConfigurado(),
    credenciais: creds.map((c) => ({
      ...c,
      diasAteExpirar: c.validoAte ? diasAteExpirar(c.validoAte) : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  const user = await getSessionUser();
  if (!user?.company_id) return NextResponse.json({ error: "Sem empresa." }, { status: 403 });

  if (!cofreConfigurado()) {
    return NextResponse.json({ error: "cofreNaoConfigurado" }, { status: 409 });
  }

  const form = await req.formData();
  const ficheiro = form.get("p12");
  const senha = String(form.get("password") ?? "");
  const ambienteBruto = String(form.get("environment") ?? "test");
  const agentTain = String(form.get("agentTain") ?? "").trim() || null;

  if (!(ficheiro instanceof File)) {
    return NextResponse.json({ error: "Falta o ficheiro .p12." }, { status: 400 });
  }
  if (!senha) {
    return NextResponse.json({ error: "Falta a senha do certificado." }, { status: 400 });
  }
  if (!ehAmbiente(ambienteBruto)) {
    return NextResponse.json({ error: "Ambiente inválido." }, { status: 400 });
  }

  let aberto;
  try {
    aberto = abrirP12(Buffer.from(await ficheiro.arrayBuffer()), senha);
  } catch (e: any) {
    // A mensagem de `abrirP12` já distingue senha errada de ficheiro errado —
    // são dois problemas com dois gestos diferentes.
    return NextResponse.json({ error: e?.message || "Não foi possível abrir o certificado." }, { status: 400 });
  }

  /*
   * Um certificado JÁ EXPIRADO é recusado à entrada.
   *
   * Aceitá-lo seria deixar o escritório com um ecrã verde e uma folha que só
   * falha no dia do pagamento, com um 401 que não explica nada.
   */
  const dias = diasAteExpirar(aberto.validoAte);
  if (dias < 0) {
    return NextResponse.json({
      error: `Este certificado expirou em ${aberto.validoAte.slice(0, 10)}. Descarregue um novo do ROS.`,
    }, { status: 400 });
  }

  await guardarCredencial({
    companyId: user.company_id,
    ambiente: ambienteBruto,
    agentTain,
    certificadoBase64: aberto.certificadoBase64,
    chavePrivadaPem: aberto.chavePrivadaPem,
    titular: aberto.titular,
    emissor: aberto.emissor,
    validoDe: aberto.validoDe,
    validoAte: aberto.validoAte,
    porQuem: user.id ?? null,
  });

  // Devolve o que o certificado DIZ DE SI — nunca o certificado, nunca a chave.
  return NextResponse.json({
    ok: true,
    titular: aberto.titular,
    emissor: aberto.emissor,
    validoAte: aberto.validoAte,
    diasAteExpirar: dias,
  });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  const user = await getSessionUser();
  if (!user?.company_id) return NextResponse.json({ error: "Sem empresa." }, { status: 403 });

  const ambiente = String(new URL(req.url).searchParams.get("environment") ?? "");
  if (!ehAmbiente(ambiente)) return NextResponse.json({ error: "Ambiente inválido." }, { status: 400 });

  await apagarCredencial(user.company_id, ambiente);
  return NextResponse.json({ ok: true });
}
