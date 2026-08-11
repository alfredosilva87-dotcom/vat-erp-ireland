import { NextRequest, NextResponse } from "next/server";
import { getBankAccount, existingDedupeKeys, importStatementLines } from "@/lib/bankStore";
import { splitByExisting } from "@/lib/bankStatement";
import { getSessionUser } from "@/lib/auth";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
// Nunca servir saldo ou linha de extrato de cache: o Next guarda resposta de
// GET por padrao, e uma tela de conciliacao que mostra trabalho ja feito e pior
// que uma tela lenta.
export const dynamic = "force-dynamic";

type Ctx = { params: { id: string; accountId: string } };

/**
 * Saves a parsed statement into one account.
 *
 * The file is read in the browser (lib/sheet.ts + lib/bankStatement.ts), so
 * what arrives here is already normalised lines — which also means it cannot be
 * trusted, and lib/bankStore.ts re-validates every field before it touches the
 * table.
 *
 * `dryRun` answers "how much of this is new?" without writing anything. That
 * question has to be answerable *before* the accountant commits, otherwise the
 * only feedback about an overlapping period arrives after the fact.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const account = await getBankAccount(params.accountId);
  if (!account || account.client_id !== params.id) {
    return NextResponse.json({ error: "Conta não encontrada." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const lines = Array.isArray(body?.lines) ? body.lines : null;
  if (!lines || !lines.length) {
    return NextResponse.json({ error: "Nenhuma linha para importar." }, { status: 400 });
  }
  if (lines.length > 20000) {
    return NextResponse.json({ error: "Arquivo grande demais (limite 20.000 linhas)." }, { status: 400 });
  }

  const known = await existingDedupeKeys(
    account.id,
    lines.map((l: any) => String(l?.dedupe_key ?? ""))
  );
  const { fresh, alreadyImported } = splitByExisting(lines, known);

  if (body?.dryRun) {
    return NextResponse.json({
      dryRun: true,
      newCount: fresh.length,
      duplicateCount: alreadyImported.length,
      // Dates already on file bound the warning to something concrete: the
      // accountant sees *which* period is repeating, not just a number.
      duplicatePeriod: periodOf(alreadyImported),
    });
  }

  const outcome = await importStatementLines(account.id, {
    lines,
    filename: body?.filename ?? null,
    format: body?.format ?? null,
    mapping: body?.mapping ?? null,
    userId: (await getSessionUser())?.id ?? null,
  });

  return NextResponse.json(outcome);
}

function periodOf(lines: Array<{ line_date?: string }>) {
  const dates = lines.map((l) => l.line_date).filter(Boolean).sort() as string[];
  return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
}
