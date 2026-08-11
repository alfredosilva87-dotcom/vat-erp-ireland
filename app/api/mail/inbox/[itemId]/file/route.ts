import { NextRequest, NextResponse } from "next/server";
import { downloadInboxFile } from "@/lib/mailStore";
import { denied, requireInboxItem } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** O anexo em bytes, para a tela ler pelo mesmo caminho de um arquivo arrastado. */
export async function GET(_req: NextRequest, { params }: { params: { itemId: string } }) {
  const access = await requireInboxItem(params.itemId);
  if (denied(access)) return access.error;

  const file = await downloadInboxFile(params.itemId);
  if (!file) return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  return new NextResponse(new Uint8Array(file.bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
    },
  });
}
