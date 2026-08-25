"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en, { type TKey } from "./en";
import pt from "./pt";
import { DEFAULT_LANG, LANG_KEY, isLang, type Lang } from "./languages";

// Only fully translated dictionaries are registered. Anything else resolves
// key by key against English, so an incomplete language can never blank a
// screen — it just shows English for the missing strings.
const DICTS: Partial<Record<Lang, Partial<Record<TKey, string>>>> = { en, pt };

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({
  children,
  initialLang = DEFAULT_LANG,
}: {
  children: React.ReactNode;
  /** Read from the cookie on the server so the first paint is already in the
   *  right language — otherwise every page load flashes English first. */
  initialLang?: Lang;
}) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    /*
     * Reconcilia com o localStorage, para sessões anteriores ao cookie.
     *
     * E ESCREVE O COOKIE DE VOLTA. Sem isso os dois ficavam a discordar para
     * sempre: o servidor pintava a tela no idioma do cookie, este efeito
     * trocava para o do localStorage, e o resultado era um piscar de idioma em
     * TODA carga de página — a tela abria em português e virava inglês meio
     * segundo depois. Enganava até quem estava a testar: um screenshot tirado
     * depressa mostrava um idioma, um tirado devagar mostrava o outro.
     *
     * Quem manda é o localStorage, que é onde a escolha da pessoa vive; o
     * cookie é só como o servidor fica a saber dela.
     */
    try {
      const stored = localStorage.getItem(LANG_KEY);
      if (isLang(stored) && stored !== lang) {
        setLangState(stored);
        document.documentElement.lang = stored;
        document.cookie = `${LANG_KEY}=${stored};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
      }
    } catch {
      /* private mode — keep what the server sent */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* the choice just won't persist */
    }
    // Cookie is what the server reads on the next request.
    document.cookie = `${LANG_KEY}=${l};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
  }, []);

  const t = useCallback(
    (key: TKey, vars?: Record<string, string | number>) => {
      const raw = DICTS[lang]?.[key] ?? en[key] ?? key;
      if (!vars) return raw;
      return Object.entries(vars).reduce(
        (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v)),
        raw
      );
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside <I18nProvider>");
  return ctx;
}

export { LANGS, type Lang } from "./languages";
export type { TKey } from "./en";
