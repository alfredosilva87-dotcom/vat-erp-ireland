import { NextResponse } from "next/server";
import { getRelaySupabase, relayConfigured } from "@/lib/relay";
import { isTokenShape } from "@/lib/phoneIntake";

export const dynamic = "force-dynamic";

/**
 * O manifesto do PWA de UM link de telefone. RODA NA NUVEM e é PÚBLICA.
 *
 * O manifesto do site inteiro (`app/manifest.ts`) é um só, com `start_url: "/"`
 * — a tela principal do ERP. Sem este arquivo, "Adicionar à Tela de Início" a
 * partir de `/enviar/<token>` criava um ícone que abria o ERP inteiro, não a
 * câmera: o Android (e o iOS mais novo) obedece o manifesto do site, não a
 * página onde a pessoa estava quando salvou. Cada link de telefone precisa do
 * seu próprio `start_url`, ou o ícone que o cliente do escritório salva mente
 * sobre para onde ele leva.
 *
 * Não recusa link inválido, revogado ou vencido: mesmo assim devolve um
 * manifesto válido apontando para `/enviar/<token>`, que é quem mostra o motivo
 * na tela. Recusar aqui quebraria a instalação do ícone antes de a pessoa
 * conseguir ver por que o link não funciona.
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  let label: string | null = null;

  if (relayConfigured() && isTokenShape(params.token)) {
    const { data } = await getRelaySupabase()
      .from("phone_links").select("label").eq("token", params.token).maybeSingle();
    label = ((data as any)?.label as string) ?? null;
  }

  const manifest = {
    name: label ? `Enviar — ${label}` : "Enviar documento",
    short_name: label ? label.slice(0, 12) : "Enviar",
    start_url: `/enviar/${params.token}`,
    scope: `/enviar/${params.token}`,
    display: "standalone",
    background_color: "#F8F7FE",
    theme_color: "#7C5CFC",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };

  return NextResponse.json(manifest, { headers: { "Content-Type": "application/manifest+json" } });
}
