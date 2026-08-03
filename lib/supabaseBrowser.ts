import { createClient } from "@supabase/supabase-js";

// Browser client (anon key). Only used by the password-recovery page — the
// rest of the app talks to the server, which uses the service-role client in
// lib/supabase.ts. This one exists purely so the recovery link's token
// (parsed from the URL by the SDK) can produce a short-lived session we hand
// to our own API to authorize the password change.
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, anonKey);
}
