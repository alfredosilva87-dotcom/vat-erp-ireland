// Languages offered in the app. The list is driven by the largest resident
// groups in Ireland (Census 2022): Polish ~93.7k, UK ~83.3k, Indian ~45.4k,
// Romanian ~43.3k, Lithuanian ~31.2k, Brazilian ~27.3k. UK and Indian users
// are already served by English, so the other slots go to Polish, Romanian and
// Spanish, with Portuguese for the Brazilian community.
//
// English and Portuguese are fully translated; the rest fall back to English
// key by key, so a partial dictionary can never produce a blank screen.

export const LANGS = [
  { code: "en", label: "English", flag: "🇮🇪", complete: true },
  { code: "pt", label: "Português", flag: "🇧🇷", complete: true },
  { code: "pl", label: "Polski", flag: "🇵🇱", complete: false },
  { code: "ro", label: "Română", flag: "🇷🇴", complete: false },
  { code: "es", label: "Español", flag: "🇪🇸", complete: false },
] as const;

export type Lang = (typeof LANGS)[number]["code"];
export const DEFAULT_LANG: Lang = "en";
export const LANG_KEY = "vat-lang";

export const isLang = (v: unknown): v is Lang =>
  typeof v === "string" && LANGS.some((l) => l.code === v);
