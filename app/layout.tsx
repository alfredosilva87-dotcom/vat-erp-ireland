import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { cookies, headers } from "next/headers";
import AppFrame from "@/components/AppFrame";
import { I18nProvider } from "@/lib/i18n";
import { DEFAULT_LANG, LANG_KEY, isLang, type Lang } from "@/lib/i18n/languages";

const display = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-display" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "VAT Reader — Ireland ERP",
  description: "Read invoices, check Irish VAT, manage clients, credits and records.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "VAT Reader" },
};

export const viewport: Viewport = {
  themeColor: "#F8F7FE",
};

// Runs before first paint so the saved theme is applied without a flash of the
// wrong palette. Defaults to dark when nothing is stored.
const themeScript = `(function(){try{var t=localStorage.getItem("vat-theme");document.documentElement.dataset.theme=t==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}})()`;

// Supabase's recovery/invite links should land on /reset-password, but if the
// project's Redirect URLs allowlist doesn't have that exact path it silently
// falls back to the bare Site URL — dropping the path but keeping the token
// in the hash. Catch that here and forward to /reset-password so the link
// still works regardless of the Supabase dashboard config.
const recoveryRedirectScript = `(function(){try{if(location.hash.indexOf("type=recovery")!==-1&&location.pathname!=="/reset-password"){location.replace("/reset-password"+location.hash)}}catch(e){}})()`;

/**
 * First supported language the browser asks for.
 *
 * Only consulted when there is no cookie — i.e. before anyone has logged in and
 * chosen. It matters for the phone capture page (`/enviar/<token>`), which is
 * public: the person opening it is the office's *client*, has no session, and so
 * would otherwise always get English no matter what their phone is set to.
 */
function acceptedLang(header: string | null): Lang | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const code = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLang(code)) return code;
  }
  return null;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieLang = cookies().get(LANG_KEY)?.value;
  const lang = isLang(cookieLang)
    ? cookieLang
    : acceptedLang(headers().get("accept-language")) || DEFAULT_LANG;

  return (
    <html
      lang={lang}
      data-theme="light"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: recoveryRedirectScript }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <I18nProvider initialLang={lang}>
          <AppFrame>{children}</AppFrame>
        </I18nProvider>
      </body>
    </html>
  );
}
