import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { denied, requireClient } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O documento que sustenta uma venda — a foto ou o PDF que o cliente mandou.
 *
 * Existe porque venda entrando por foto sem poder rever a imagem é número sem
 * prova: na conferência do VAT3 o contador precisa abrir o documento, igual já
 * fazia do lado da compra.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string; saleId: string } }) {
  const access = await requireClient(params.id);
  if (denied(access)) return access.error;

  const sb = getServerSupabase();
  const { data: sale } = await sb
    .from("sales").select("document_path, original_filename")
    .eq("id", params.saleId).eq("client_id", params.id).maybeSingle();
  if (!sale?.document_path) {
    return NextResponse.json({ error: "Esta venda não tem documento guardado." }, { status: 404 });
  }

  const { data, error } = await sb.storage.from("documents").download(sale.document_path);
  if (error || !data) {
    return NextResponse.json({ error: "Documento indisponível." }, { status: 404 });
  }
  const ext = (sale.document_path.split(".").pop() || "").toLowerCase();
  const mime = ext === "pdf" ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext || "png"}`;
  return new NextResponse(new Uint8Array(await data.arrayBuffer()), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${(sale.original_filename || `venda.${ext}`).replace(/"/g, "")}"`,
    },
  });
}
