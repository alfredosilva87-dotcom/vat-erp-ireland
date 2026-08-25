"use client";

/**
 * Troca de tema — a versão da BARRA DO TOPO, quadrada e sem rótulo.
 *
 * Subiu do pé da barra lateral porque é um controlo de ambiente, e controlo de
 * ambiente mora junto de quem está logado, não no fundo do menu de navegação.
 * Embaixo ficaram só as duas ações que são mesmo da barra: recolher e sair.
 *
 * A lógica de pintar a moldura da janela é a mesma da versão anterior, e por
 * isso vive num arquivo só — ver components/ThemeToggleRow.tsx, que continua
 * a servir o menu de dentro do cliente enquanto ele tiver rodapé próprio.
 */

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { THEME_KEY, type Theme } from "@/components/ThemeToggle";
import { paintWindowChrome } from "@/components/themeChrome";

const S = {
  stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

export default function ThemeToggleButton() {
  const { t } = useT();
  // Nulo no primeiro render para casar com o que o servidor mandou; o tema real
  // já está no <html>, aplicado antes da primeira pintura.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || "light";
    setTheme(current);
    paintWindowChrome(current);
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* modo privado — a escolha só não persiste */
    }
    setTheme(next);
    paintWindowChrome(next);
  }

  const isLight = theme !== "dark";
  const label = isLight ? t("nav.themeToDark") : t("nav.themeToLight");

  return (
    <button
      onClick={toggle}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      title={label}
      aria-label={label}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {isLight ? (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" {...S} />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" {...S} />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" {...S} />
          </>
        )}
      </svg>
    </button>
  );
}
