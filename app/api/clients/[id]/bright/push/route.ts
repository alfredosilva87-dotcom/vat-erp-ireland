import { NextRequest, NextResponse } from "next/server";
import { getBrightConnector } from "@/lib/brightApi";

export const runtime = "nodejs";
// Resposta sempre do banco, nunca de cache: o Next 14 guarda GET de rota por
// padrao, e uma lista que volta desatualizada num sistema contabil nao e lentidao
// evitada, e numero errado na tela.
export const dynamic = "force-dynamic";

// GET  → estado da conexão (testConnection). Usado pelo card da UI.
export async function GET(_req: NextRequest, { params: _params }: { params: { id: string } }) {
  const connector = getBrightConnector(); // sem credenciais → api_not_available
  const status = await connector.testConnection();
  return NextResponse.json({ configured: connector.configured, status });
}

// POST → tenta enviar (contacts | purchases). Hoje responde 501 com motivo.
export async function POST(req: NextRequest, { params: _params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const kind = body?.kind === "contacts" ? "contacts" : "purchases";
  const rows: unknown[] = Array.isArray(body?.rows) ? body.rows : [];

  const connector = getBrightConnector();
  const result =
    kind === "contacts"
      ? await connector.pushContacts(rows)
      : await connector.pushPurchaseInvoices(rows);

  // 501 quando a API ainda não está disponível; 200 quando (futuramente) ok.
  return NextResponse.json(result, { status: result.ok ? 200 : 501 });
}
