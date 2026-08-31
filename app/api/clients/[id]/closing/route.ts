import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { estadoDoFechamento, fecharPeriodo, reabrirPeriodo } from "@/lib/accounting/fechamento";
import { limitesDoMes } from "@/lib/accounting/fechamentoPuro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A rotina de fechamento contábil — ver lib/accounting/fechamento.ts.
 *
 * O recorte é o MÊS, e vem em ano+mês e não em duas datas soltas. Um fecho de
 * "12/03 a 27/04" não é fechamento de nada, e aceitar datas livres aqui
 * deixaria o cadeado com buracos que ninguém veria até tentar lançar dentro de
 * um deles.
 */

function mesDoPedido(sp: URLSearchParams | Record<string, any>) {
  const ler = (k: string) =>
    Number(sp instanceof URLSearchParams ? sp.get(k) : (sp as any)?.[k]);
  const hoje = new Date();
  const ano = ler("ano") || hoje.getUTCFullYear();
  const mes = ler("mes") || hoje.getUTCMonth() + 1;
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2200) return null;
  return limitesDoMes(ano, mes);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const mes = mesDoPedido(new URL(req.url).searchParams);
  if (!mes) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });

  try {
    return NextResponse.json(await estadoDoFechamento(params.id, mes.de, mes.ate));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const b = await req.json().catch(() => ({}));
  const mes = mesDoPedido(b);
  if (!mes) return NextResponse.json({ error: "Mês inválido." }, { status: 400 });

  const r = await fecharPeriodo({
    clientId: params.id, de: mes.de, ate: mes.ate,
    note: b?.note ?? null,
    userId: (await getSessionUser())?.id ?? null,
  });
  // 409 e não 400: o pedido está certo, o estado é que impede. A tela mostra
  // as pendências que vêm no corpo.
  if (!r.ok) return NextResponse.json({ error: r.erro, impedimentos: r.impedimentos ?? [] }, { status: 409 });
  return NextResponse.json(r);
}

/** Reabrir — com motivo, e sem apagar o registo do fecho. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const b = await req.json().catch(() => ({}));
  const r = await reabrirPeriodo({
    clientId: params.id,
    id: String(b?.id ?? ""),
    motivo: String(b?.motivo ?? ""),
    userId: (await getSessionUser())?.id ?? null,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json(r);
}
