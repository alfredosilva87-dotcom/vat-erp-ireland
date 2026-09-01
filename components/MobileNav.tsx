"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * O menu lateral vira gaveta no telefone.
 *
 * No desktop as duas barras (geral e do módulo) ficam na linha do layout e
 * empurram o conteúdo — é o desenho aprovado e não muda. Abaixo de `lg` isso
 * não cabe: a barra do módulo tem 240px fixos, e num ecrã de 375 sobravam 135
 * para a tela inteira. Fora da linha do layout, a mesma barra passa a ser uma
 * gaveta por cima, e o conteúdo recebe a largura toda.
 *
 * O estado vive aqui porque quem ABRE (o botão na barra do topo) e quem é
 * ABERTO (a barra lateral) são irmãos, não pai e filho.
 */
type MobileNavState = { open: boolean; setOpen: (v: boolean) => void };

const Ctx = createContext<MobileNavState>({ open: false, setOpen: () => {} });

export function useMobileNav() {
  return useContext(Ctx);
}

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navegar fecha a gaveta. Sem isto, tocar num item deixava a tela nova
  // escondida por trás do menu que a abriu.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc fecha, e o corpo não rola por baixo da gaveta aberta.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = anterior;
    };
  }, [open]);

  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

/**
 * O véu por trás da gaveta: escurece o conteúdo e fecha ao toque.
 *
 * `lg:hidden` porque no desktop não existe gaveta nenhuma para velar.
 */
export function MobileNavBackdrop() {
  const { open, setOpen } = useMobileNav();
  if (!open) return null;
  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-40 bg-night/50 backdrop-blur-[1px] lg:hidden"
    />
  );
}
