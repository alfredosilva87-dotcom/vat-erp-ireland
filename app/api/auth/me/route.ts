import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { hasSupabaseConfig, getServerSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

// Company license fields are read fresh on every call rather than trusted
// from the JWT — the licence can be renewed or revoked at any point during
// the 7-day session, and the alert banner needs to reflect that immediately.
export async function GET() {
  const user = await getSessionUser();
  let company: { name: string; active: boolean; license_expires_at: string | null } | null = null;
  if (user?.company_id && hasSupabaseConfig()) {
    const { data } = await getServerSupabase()
      .from("companies")
      .select("name, active, license_expires_at")
      .eq("id", user.company_id)
      .maybeSingle();
    company = (data as typeof company) ?? null;
  }
  return NextResponse.json({ user, company });
}
