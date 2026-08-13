import { createClient } from "@supabase/supabase-js";

/**
 * A passagem na nuvem da camada B4.
 *
 * É um projeto Supabase SEPARADO do banco do escritório, e separado também do
 * que o cliente usa para teste. Por isso variáveis próprias: confundir os dois
 * faria a foto de nota fiscal cair no banco de demonstração.
 *
 * As MESMAS variáveis nas duas implantações, apontando para o mesmo projeto:
 *   - na nuvem (Vercel), para receber a foto e validar o link;
 *   - no servidor do escritório, para buscar, apagar e empurrar a cópia do link.
 *
 * O escritório só fala com a passagem PARA FORA — nenhuma porta é aberta na
 * rede dele, que é a premissa que o self-host inteiro protege.
 */
export const RELAY_BUCKET = "phone-uploads";

export function relayConfigured(): boolean {
  return Boolean(process.env.RELAY_SUPABASE_URL && process.env.RELAY_SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Onde a tela de captura está publicada, para o escritório poder copiar o link
 * inteiro e mandar por WhatsApp.
 *
 * Vem do ambiente porque este servidor **não é** quem serve a captura — ela está
 * na nuvem, e o servidor não tem como descobrir esse endereço sozinho. Mostrar
 * só o token seria dar ao contador metade do que ele precisa copiar, que foi
 * exatamente a lição do `MAIL_INBOX_ADDRESS` na camada B2.
 *
 * A barra final é removida para o link não sair com `//enviar`.
 */
export function captureBaseUrl(): string | null {
  const raw = (process.env.PHONE_CAPTURE_URL || "").trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

/**
 * Cliente da passagem, com chave de serviço.
 *
 * Serviço e não anônima porque a passagem tem RLS ligada sem nenhuma política —
 * a chave anônima não lê nem escreve nada lá. Toda validação de token acontece
 * aqui no servidor, antes de tocar no banco.
 *
 * Só de código de servidor. A tela de captura é pública, e o que ela carregasse
 * estaria nas mãos de qualquer um.
 */
export function getRelaySupabase() {
  const url = process.env.RELAY_SUPABASE_URL;
  const key = process.env.RELAY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Entrada por telefone não configurada. Defina RELAY_SUPABASE_URL e RELAY_SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
