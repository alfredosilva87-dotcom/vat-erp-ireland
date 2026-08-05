import type { MetadataRoute } from "next";

// Lets Chrome/Edge offer "Install app" (desktop icon + its own window,
// no browser chrome). No service worker on purpose — this is a live
// financial tool talking to Supabase, so it should never serve cached
// data while looking offline-capable.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VAT Reader — Ireland ERP",
    short_name: "VAT Reader",
    description: "Read invoices, check Irish VAT, manage clients, credits and records.",
    start_url: "/",
    display: "standalone",
    background_color: "#0E0A20",
    theme_color: "#0E0A20",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
