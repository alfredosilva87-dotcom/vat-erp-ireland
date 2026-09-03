import { NextRequest, NextResponse } from "next/server";
import { saveInvoice, listInvoices, listMasterItems, stats, SEM_CLIENTE } from "@/lib/store";
import type { SavePayload } from "@/lib/store";
import { findDuplicate } from "@/lib/duplicates";
import { denied, requireClient, visibleClientIds } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || undefined;
  const clientId = searchParams.get("client") || undefined;
  const branchId = searchParams.get("branch") || undefined;
  const start = searchParams.get("start") || undefined;
  const end = searchParams.get("end") || undefined;
  const needsReview = searchParams.get("review") === "1";
  const idsParam = searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : undefined;
  const view = searchParams.get("view"); // "items" for de-para master

  // Recorte por empresa (lib/access.ts). Sem ele, esta rota sem `client`
  // devolvia as notas de TODOS os escritórios da instalação.
  const allowed = await visibleClientIds();
  if (allowed && "error" in allowed) return allowed.error;
  // O sentinela "sem cliente" não é um id: não há cliente a que pedir acesso, e
  // o próprio listInvoices devolve vazio a quem tem recorte por empresa.
  if (clientId && clientId !== SEM_CLIENTE) {
    const access = await requireClient(clientId);
    if (denied(access)) return access.error;
  }

  // `year` é o exercício fiscal da barra do topo; só o painel manda. As telas
  // de trabalho (Compras, Vendas, banco) não filtram por ele de propósito —
  // quem procura UMA nota procura pela nota, não pelo ano.
  const yearParam = Number(searchParams.get("year"));
  const year = Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100
    ? yearParam : undefined;

  if (view === "items") {
    return NextResponse.json({ items: await listMasterItems(q), stats: await stats(clientId, allowed, year) });
  }
  return NextResponse.json({
    invoices: await listInvoices({ q, clientId, branchId, start, end, needsReview, ids, allowedClientIds: allowed }),
    stats: await stats(clientId, allowed, year),
  });
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const metaRaw = form.get("meta");
    if (typeof metaRaw !== "string") {
      return NextResponse.json({ error: "Missing meta payload." }, { status: 400 });
    }
    const payload = JSON.parse(metaRaw) as SavePayload;
    if (!payload?.items?.length) {
      return NextResponse.json({ error: "No items to save." }, { status: 400 });
    }
    // Gravar nota PARA um cliente é o mesmo que escrever no cliente: quem não
    // pode ver o cliente não pode lançar nele.
    if (payload.client_id) {
      const access = await requireClient(payload.client_id);
      if (denied(access)) return access.error;
    }

    const file = form.get("file");
    let buffer: Buffer | null = null;
    let ext = "bin";
    if (file instanceof File) {
      buffer = Buffer.from(await file.arrayBuffer());
      const name = file.name || "";
      ext = name.includes(".") ? name.split(".").pop()! : (file.type.split("/")[1] || "bin");
    }

    const force = form.get("force") === "true";
    if (!force) {
      const existing = await findDuplicate(payload.client_id, {
        supplier_name: payload.header.supplier_name,
        invoice_number: payload.header.invoice_number,
        barcode: payload.header.barcode,
        invoice_date: payload.header.invoice_date,
        total_gross: payload.header.total_gross,
      });
      if (existing) {
        return NextResponse.json({ error: "duplicate", existing }, { status: 409 });
      }
    }

    const invoice = await saveInvoice(payload, buffer, ext, await getSessionUser());
    return NextResponse.json({ ok: true, invoice });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Save failed." }, { status: 500 });
  }
}
