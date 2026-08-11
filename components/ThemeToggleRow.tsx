"use client";

/**
 * Troca de tema, no formato das outras linhas da barra lateral.
 *
 * Era um quadrado sozinho numa faixa no topo da tela — a faixa saiu porque
 * sobrava só ele nela, e um botão não justifica uma faixa.
 */

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { THEME_KEY, type Theme } from "@/components/ThemeToggle";

const S = { stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export default function ThemeToggleRow({ showLabel }: { showLabel: string }) {
  const { t } = useT();
  // Nulo no primeiro render para casar com o que o servidor mandou; o tema real
  // já está no <html>, aplicado antes da primeira pintura.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme) || "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* modo privado */ }
    setTheme(next);
  }

  const isLight = theme !== "dark";
  const label = isLight ? t("nav.themeToDark") : t("nav.themeToLight");

  return (
    <button
      onClick={toggle}
      className="mt-2 flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-night-muted transition-colors hover:bg-night-hover/8 hover:text-night-ink"
      title={label}
      aria-label={label}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
        {isLight ? (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" {...S} />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" {...S} />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" {...S} />
          </>
        )}
      </svg>
      <span className={showLabel}>{label}</span>
    </button>
  );
}
