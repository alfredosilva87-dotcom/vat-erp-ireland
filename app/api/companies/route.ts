import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { listCompanies, createCompany, companyStats } from "@/lib/store";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

// Tenant administration is master-only — an admin manages their own company's
// users, not the roster of companies.
export async function GET() {
  const guard = await requireRole("master");
  if ("error" in guard) return guard.error;

  const [companies, stats] = await Promise.all([listCompanies(), companyStats()]);
  return NextResponse.json({ companies, stats });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole("master");
  if ("error" in guard) return guard.error;

  const body = await req.json();
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "Company name is required." }, { status: 400 });

  try {
    const company = await createCompany({
      name,
      slug: body?.slug ? String(body.slug) : undefined,
      contact_email: body?.contact_email ?? null,
      months: Number(body?.months) || 12,
    });
    return NextResponse.json({ company });
  } catch (e: any) {
    // Unique violation on slug is the realistic failure here.
    const msg = e?.code === "23505" ? "That identifier is already taken." : e?.message || "Create failed.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
