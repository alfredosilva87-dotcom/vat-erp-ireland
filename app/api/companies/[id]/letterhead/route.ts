import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Os dados do escritório que vão no timbre das demonstrações.
 *
 * Rota própria, e não o `PATCH /api/companies/[id]`, porque aquele é do perfil
 * `master`. Quem preenche a morada e o número de registo é o DONO do
 * escritório, que na instalação dele é `admin` — a mesma razão que já levou a
 * licença a ganhar uma rota de auto-serviço. Alargar a rota do master daria a
 * um admin o poder de mexer em licença e estado da empresa de passagem.
 */

const CAMPOS = [
  "name", "address", "phone", "website", "contact_email",
  "registration_no", "signer_name", "signer_title",
] as const;

/** Só a própria empresa, e nunca a de outro. */
async function guarda(id: string) {
  const g = await requireRole("admin");
  if ("error" in g) return { error: g.error };
  if (g.user.company_id !== id) {
    return { error: NextResponse.json({ error: "Not your company." }, { status: 403 }) };
  }
  return { user: g.user };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guarda(params.id);
  if ("error" in g) return g.error;

  const { data, error } = await getServerSupabase()
    .from("companies").select(CAMPOS.join(",")).eq("id", params.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guarda(params.id);
  if ("error" in g) return g.error;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, string | null> = {};
  for (const campo of CAMPOS) {
    if (!(campo in body)) continue;
    const valor = String(body[campo] ?? "").trim();
    // Campo esvaziado grava NULO e não string vazia: o timbre desenha só as
    // linhas preenchidas, e `""` contaria como preenchida — sairia uma linha
    // em branco no meio do cabeçalho.
    patch[campo] = valor === "" ? null : valor;
  }
  // O nome é o que identifica o escritório em todo o lado; apagá-lo deixaria
  // o timbre sem dono e a lista de empresas sem rótulo.
  if ("name" in patch && !patch.name) {
    return NextResponse.json({ error: "The firm name cannot be empty." }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true });

  const { data, error } = await getServerSupabase()
    .from("companies").update(patch).eq("id", params.id).select(CAMPOS.join(",")).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as any) });
}
