import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { available, issue, list } from "@/lib/licenseVault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emitir e listar licenças. SÓ na máquina de quem vende.
 *
 * Sem chave privada no disco, responde 404 e não 403: numa instalação de
 * cliente esta funcionalidade não existe, e dizer "proibido" já contaria que
 * ela existe e convidaria a tentar.
 */
function semCofre() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

export async function GET() {
  const guard = await requireRole("master");
  if ("error" in guard) return guard.error;
  if (!available()) return semCofre();
  return NextResponse.json(list());
}

export async function POST(req: NextRequest) {
  const guard = await requireRole("master");
  if ("error" in guard) return guard.error;
  if (!available()) return semCofre();

  const body = await req.json().catch(() => ({}));
  const slug = String(body?.slug || "").trim().toLowerCase();
  const name = String(body?.name || "").trim();
  const months = Number(body?.months);

  // O slug é o que amarra a chave à instalação: uma chave emitida para o slug
  // errado não ativa em lado nenhum e só se descobre quando o cliente reclama.
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
    return NextResponse.json(
      { error: "Slug invalido: use letras minusculas, numeros e hifen." }, { status: 400 }
    );
  }
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    return NextResponse.json({ error: "Meses precisa ser inteiro entre 1 e 120." }, { status: 400 });
  }

  try {
    return NextResponse.json(issue({ slug, name, months }));
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falhou." }, { status: 500 });
  }
}
