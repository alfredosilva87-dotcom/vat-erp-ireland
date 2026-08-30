import { createClient } from "@supabase/supabase-js";

/**
 * Where *this process* reaches Supabase.
 *
 * On a single machine both sides use the same address. In the server
 * deployment they differ: the browser goes through the HTTPS reverse proxy
 * (`NEXT_PUBLIC_SUPABASE_URL`, baked into the bundle at build time), while the
 * Next.js server sits on the same Docker network and talks to Kong directly
 * (`SUPABASE_INTERNAL_URL`) — which keeps the API off the LAN entirely.
 */
function serverUrl() {
  return process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

// Server-side client (uses the service role key). Only import from server code
// (API routes / server components) — never expose the service key to the browser.
export function getServerSupabase() {
  const url = serverUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: {
      /*
       * TODA a leitura do banco é `no-store`. Isto não é afinação — é correcção.
       *
       * O supabase-js usa `fetch` por baixo, e o Next.js 14 GUARDA os `fetch`
       * feitos no servidor. Numa rota com sessão isso não se nota, porque ler o
       * cookie já a torna dinâmica; numa rota SEM cookies — como a fatura
       * partilhada — o resultado fica em cache e o banco deixa de ser
       * consultado.
       *
       * Foi assim que se apanhou: uma fatura anulada continuava a abrir pelo
       * link, e revogar o link também não o fechava. O banco estava certo nos
       * dois casos; o que respondia era a cache. Num sistema contábil, uma
       * leitura que não vê a escrita que acabou de acontecer é das falhas mais
       * caras que há — não dá erro, dá um número desactualizado com ar de
       * verdade.
       *
       * Fica no cliente e não em cada rota de propósito: uma regra que depende
       * de alguém se lembrar de a repetir na rota nova não é uma regra.
       */
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

export function hasSupabaseConfig() {
  return Boolean(serverUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
