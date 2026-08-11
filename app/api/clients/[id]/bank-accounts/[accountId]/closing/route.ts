import { NextRequest, NextResponse } from "next/server";
import { getBankAccount } from "@/lib/bankStore";
import { closingReportFor, listClosings, saveClosing } from "@/lib/bankClosingStore";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; accountId: string } };

/**
 * O relatório de conciliação numa data.
 *
 * `saldo` (opcional) é o saldo final que o contador leu no extrato de papel —
 * o único número do relatório que não sai do sistema, e por isso o único capaz
 * de acusar uma linha que nunca foi importada.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const account = await getBankAccount(params.accountId);
  if (!account || account.client_id !== params.id) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const q = req.nextUrl.searchParams;
  const asOf = q.get("asOf") || new Date().toISOString().slice(0, 10);
  const raw = q.get("saldo");
  const reported = raw === null || raw.trim() === "" ? null : Number(raw.replace(",", "."));

  const [view, history] = await Promise.all([
    closingReportFor(params.accountId, asOf, Number.isFinite(reported as number) ? reported : null),
    listClosings(params.accountId),
  ]);
  if (!view) return NextResponse.json({ error: "Data inválida." }, { status: 400 });

  return NextResponse.json({ account, asOf, ...view, history });
}

/** Fecha o período: guarda o relatório aceito e liga o cadeado. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const account = await getBankAccount(params.accountId);
  if (!account || account.client_id !== params.id) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const asOf = String(body?.asOf ?? "");
  const raw = body?.reportedBalance;
  const reported = raw === null || raw === undefined || raw === "" ? null : Number(String(raw).replace(",", "."));

  const result = await saveClosing(
    params.accountId, params.id, asOf,
    {
      reportedBalance: Number.isFinite(reported as number) ? reported : null,
      note: body?.note ?? null,
      locked: body?.locked !== false,
    },
    (await getSessionUser())?.id ?? null
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
