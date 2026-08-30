import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O logótipo do cliente, para o cabeçalho da fatura.
 *
 * NÃO vai para `client_documents`: aquele cofre guarda documentos de
 * compliance, que caducam e se apresentam a terceiros. Um logótipo é aparência,
 * é um só, e substitui-se — misturá-lo lá dentro faria o cofre passar a ter uma
 * linha que nunca é para mostrar a ninguém.
 */

const BUCKET = "documents";
// PNG e JPEG só: é o que o pdf-lib sabe embutir. Aceitar um SVG ou um WEBP aqui
// daria um logótipo que grava bem e desaparece do PDF, sem erro nenhum.
const ACEITES = ["image/png", "image/jpeg"];
const MAX = 2 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Escolha um ficheiro." }, { status: 400 });
  }
  const mime = (file.type || "").split(";")[0].toLowerCase();
  if (!ACEITES.includes(mime)) {
    return NextResponse.json(
      { error: "O logótipo tem de ser PNG ou JPEG — é o que entra no PDF da fatura." },
      { status: 400 }
    );
  }
  if (file.size > MAX) {
    return NextResponse.json({ error: "O logótipo tem de ter menos de 2 MB." }, { status: 400 });
  }

  const sb = getServerSupabase();
  const ext = mime === "image/png" ? "png" : "jpg";
  // Caminho FIXO por cliente: o logótipo é um só, e substituir sem deixar
  // rasto evita uma pasta a encher de versões antigas que ninguém apaga.
  const path = `client-logos/${params.id}.${ext}`;

  const { error } = await sb.storage.from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: mime, upsert: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Trocar de PNG para JPEG deixaria o ficheiro antigo para trás.
  const outro = `client-logos/${params.id}.${ext === "png" ? "jpg" : "png"}`;
  try { await sb.storage.from(BUCKET).remove([outro]); } catch { /* pode não existir */ }

  await sb.from("clients").update({ logo_path: path }).eq("id", params.id);
  return NextResponse.json({ ok: true, logoPath: path });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sb = getServerSupabase();
  const { data: c } = await sb.from("clients").select("logo_path").eq("id", params.id).maybeSingle();
  const path = (c as any)?.logo_path;
  if (!path) return NextResponse.json({ error: "Sem logótipo." }, { status: 404 });

  const { data } = await sb.storage.from(BUCKET).download(path);
  if (!data) return NextResponse.json({ error: "Sem logótipo." }, { status: 404 });

  return new NextResponse(Buffer.from(await data.arrayBuffer()) as any, {
    headers: {
      "Content-Type": path.endsWith(".png") ? "image/png" : "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sb = getServerSupabase();
  const { data: c } = await sb.from("clients").select("logo_path").eq("id", params.id).maybeSingle();
  const path = (c as any)?.logo_path;
  await sb.from("clients").update({ logo_path: null }).eq("id", params.id);
  if (path) { try { await sb.storage.from(BUCKET).remove([path]); } catch { /* órfão */ } }
  return NextResponse.json({ ok: true });
}
