import { getRelaySupabase, relayConfigured } from "@/lib/relay";
import { isTokenShape, linkVerdict, type PhoneLink } from "@/lib/phoneIntake";
import PhoneCapture from "@/components/PhoneCapture";

export const dynamic = "force-dynamic";

/**
 * A porta de entrada do cliente do escritório. RODA NA NUVEM e é PÚBLICA.
 *
 * O link é conferido no servidor, não no navegador: link ruim mostra o motivo em
 * vez de abrir uma tela de captura que iria falhar só no fim, depois de a pessoa
 * já ter tirado a foto.
 *
 * Não expõe nada além do rótulo — o nome do próprio negócio de quem abriu, que
 * ele obviamente já sabe. Sem lista de documentos, sem histórico, sem valor: o
 * token escreve e não lê, e esta página respeita isso.
 */

/**
 * O manifesto é POR LINK (`/api/phone/manifest/<token>`), não o do site.
 *
 * Sem isto, "Adicionar à Tela de Início" nesta página herdava o manifesto
 * global do ERP — `start_url: "/"` — e o ícone que o cliente salva abria a
 * tela principal do sistema em vez da câmera. Cada link aponta para si mesmo.
 *
 * Sem indexação: o link é enviado por WhatsApp e não deve aparecer em busca.
 */
export async function generateMetadata({ params }: { params: { token: string } }) {
  let label: string | null = null;
  if (relayConfigured() && isTokenShape(params.token)) {
    const { data } = await getRelaySupabase()
      .from("phone_links").select("label").eq("token", params.token).maybeSingle();
    label = ((data as any)?.label as string) ?? null;
  }
  return {
    robots: { index: false, follow: false },
    manifest: `/api/phone/manifest/${params.token}`,
    appleWebApp: { capable: true, statusBarStyle: "default" as const, title: label || "Enviar" },
  };
}

function Aviso({ titulo, ajuda }: { titulo: string; ajuda?: string }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <p className="font-display text-xl">{titulo}</p>
      {ajuda && <p className="mt-2 text-sm text-muted">{ajuda}</p>}
    </div>
  );
}

export default async function EnviarPage({ params }: { params: { token: string } }) {
  // Textos desta guarda ficam em inglês porque ela roda antes de sabermos algo
  // sobre quem abriu; o dicionário entra na tela de captura, que é a que a pessoa
  // certa vê. Preferi isso a adivinhar a língua para dizer "link inválido".
  if (!relayConfigured()) {
    return <Aviso titulo="Phone intake is not configured on this deployment." />;
  }
  if (!isTokenShape(params.token)) {
    return <Aviso titulo="This link does not work." ajuda="Ask your accountant for a new link." />;
  }

  const relay = getRelaySupabase();
  const { data } = await relay
    .from("phone_links")
    .select("token, client_id, label, person, allow_sale, active, expires_at")
    .eq("token", params.token)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const verdict = linkVerdict(data as PhoneLink | null, today);
  if (!verdict.ok) {
    const titulo = verdict.reason === "expired" ? "This link has expired."
      : verdict.reason === "inactive" ? "This link has been turned off."
      : "This link does not work.";
    return <Aviso titulo={titulo} ajuda="Ask your accountant for a new link." />;
  }

  const link = verdict.link as PhoneLink & { label: string | null };
  return (
    <PhoneCapture token={link.token} label={link.label ?? null} allowSale={link.allow_sale} />
  );
}
