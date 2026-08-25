import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { setWeekState } from "@/lib/hr/store";
import { getSessionUser } from "@/lib/auth";
import { garantirTituloDeFolha, removerTituloDeFolha } from "@/lib/financial/payrollTitles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ESTADOS = new Set(["na", "pending", "done", "skip"]);
const CAMPOS = new Set(["payslip", "er", "ee", "ros"]);
const TIPOS = new Set(["weekly", "fortnightly", "monthly"]);

/**
 * Marca um dos quatro estados de uma semana.
 *
 * O cliente vem no CORPO e não no caminho, então o guarda tem de ser chamado
 * com ele à mão — `requireClient` faz a mesma conferência de empresa que as
 * rotas com id na URL. Sem isto, o id de uma empresa de outro escritório no
 * corpo do pedido escrevia na folha dela.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const clientId = String(body?.client_id || "");
  if (!clientId) return NextResponse.json({ error: "Missing client." }, { status: 400 });

  const acesso = await requireClient(clientId);
  if (denied(acesso)) return acesso.error;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const year = Number(body?.year);
  const week = Number(body?.week_no);
  const freq = String(body?.freq_type || "");
  const field = String(body?.field || "");
  const value = String(body?.value || "");

  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    return NextResponse.json({ error: "Invalid year." }, { status: 400 });
  if (!Number.isInteger(week) || week < 1 || week > 53)
    return NextResponse.json({ error: "Invalid week." }, { status: 400 });
  if (!TIPOS.has(freq)) return NextResponse.json({ error: "Invalid payslip type." }, { status: 400 });
  if (!CAMPOS.has(field)) return NextResponse.json({ error: "Invalid field." }, { status: 400 });
  if (!ESTADOS.has(value)) return NextResponse.json({ error: "Invalid state." }, { status: 400 });

  const ok = await setWeekState(clientId, year, week, freq, field as any, value as any, user.id);
  if (!ok) return NextResponse.json({ error: "Could not save." }, { status: 500 });

  /*
   * Marcar o payslip como FEITO abre a conta a pagar da folha.
   *
   * Sem isto, o pagamento da folha aparecia na conciliação bancária como uma
   * transferência grande, todo mês, sem documento contra o qual casar — e
   * ficava para trás, a engordar a lista do que não bate. Ver
   * lib/financial/payrollTitles.ts.
   *
   * Desmarcar desfaz, mas só enquanto ninguém pagou: um título com baixa não
   * desaparece porque alguém corrigiu uma marca no quadro.
   */
  let titulo: unknown = undefined;
  if (field === "payslip") {
    try {
      titulo = value === "done"
        ? await garantirTituloDeFolha(clientId, year, week, freq)
        : await removerTituloDeFolha(clientId, year, week, freq);
    } catch (e: any) {
      /*
       * A marca no quadro JÁ FOI GRAVADA acima. Se o título falhar, o estado
       * da semana não pode ser desfeito por isso — o contabilista marcou o
       * payslip e o payslip está marcado. O erro volta como aviso, e não como
       * 500: um 500 aqui faria a tela dizer que nada foi gravado quando
       * metade foi, que é a pior mensagem possível.
       */
      titulo = { erro: e?.message || "Falhou ao abrir a conta a pagar da folha." };
    }
  }
  return NextResponse.json({ ok: true, titulo });
}
