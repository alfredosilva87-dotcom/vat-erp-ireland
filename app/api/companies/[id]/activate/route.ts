import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { activateLicense, getCompany } from "@/lib/store";
import { licenseStatus } from "@/lib/license";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A própria licença, para o admin ver o que tem.
 *
 * Faltava isto: o painel de licenças é do perfil `master`, e com razão — mas o
 * dono do escritório é `admin` na instalação DELE, e precisava ver a validade da
 * própria licença sem depender de ninguém. Antes a tela só oferecia colar uma
 * chave nova, sem dizer o que já existia.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  if (guard.user.company_id !== params.id) {
    return NextResponse.json({ error: "Not your company." }, { status: 403 });
  }
  const company = await getCompany(params.id);
  if (!company) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({
    name: company.name,
    slug: company.slug,
    active: company.active,
    expiresAt: company.license_expires_at,
    state: licenseStatus(company.license_expires_at, company.active),
    // A chave inteira não volta: ela não é segredo, mas mostrar 251 caracteres
    // não ajuda ninguém a decidir nada.
    signed: Boolean(company.license_key?.startsWith("VATERP1.")),
    pendingExpiresAt: company.pending_license_expires_at,
  });
}

// Company admin self-service: activates a renewal key master handed them out
// of band. Deliberately scoped to the caller's own company — an admin can
// never activate a licence for a company they don't belong to.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  if (guard.user.company_id !== params.id) {
    return NextResponse.json({ error: "Not your company." }, { status: 403 });
  }

  const body = await req.json();
  const key = String(body?.key || "").trim();
  if (!key) return NextResponse.json({ error: "Enter the activation key." }, { status: 400 });

  const result = await activateLicense(params.id, key, guard.user.email);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, expiresAt: result.expiresAt });
}
