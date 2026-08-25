"use client";

import type { Theme } from "@/components/ThemeToggle";

/**
 * Pinta a barra da JANELA (não da página) com a cor do tema.
 *
 * Instalado como aplicativo, o navegador colore a moldura da janela com a
 * `theme-color`. Sem atualizar isso na troca de tema, quem usa escuro fica com
 * uma faixa clara em volta de uma tela escura — o detalhe que denuncia que
 * aquilo ainda é uma aba, não um programa.
 *
 * O manifesto não serve aqui: ele é estático e não sabe da escolha guardada.
 *
 * Vive num arquivo próprio desde que a troca de tema passou a existir em dois
 * formatos — o botão da barra do topo e a linha do menu lateral. Duas cópias
 * desta função acabariam a divergir no dia em que alguém ajustasse uma cor.
 */
export function paintWindowChrome(theme: Theme) {
  const color = theme === "dark" ? "#191527" : "#F8F7FE";
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = color;
}
