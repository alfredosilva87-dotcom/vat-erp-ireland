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
  });
}

export function hasSupabaseConfig() {
  return Boolean(serverUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
