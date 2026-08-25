"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * O ano em que o RH trabalha — dele, e só dele.
 *
 * Chegou a ler o exercício fiscal da barra do topo, e foi revertido de
 * propósito: aquele seletor é consumido por UMA tela do ERP (o painel do
 * cliente) e ignorado por todas as outras, então amarrar o RH a ele dava a
 * um controlo já pouco confiável um sexto consumidor, sem que ninguém tivesse
 * decidido que a folha e o VAT andam no mesmo ano.
 *
 * E não andam necessariamente: o VAT fecha por período de dois meses e o
 * escritório pode estar a rever 2025 enquanto a folha da semana corrente é de
 * 2026. Enquanto a integração não for desenhada com o Matheus, o RH tem o seu
 * ano e diz qual é, na própria tela.
 *
 * Guardado em chave própria, para a escolha sobreviver ao recarregar sem
 * mexer no exercício do resto do ERP.
 */
const KEY = "vat.hr.year";
const EVENT = "hr-year-changed";

const anoCorrente = () => new Date().getFullYear();

function ler(): number {
  if (typeof window === "undefined") return anoCorrente();
  const raw = localStorage.getItem(KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : anoCorrente();
}

/** Os anos oferecidos: o próximo, o corrente e dois anteriores. */
export const hrYearOptions = (): number[] => {
  const a = anoCorrente();
  return [a + 1, a, a - 1, a - 2];
};

export function useHrYear(): [number, (y: number) => void] {
  // Começa no ano corrente e reconcilia depois de montar: ler `localStorage`
  // durante a renderização dá diferença entre servidor e cliente, e o React
  // acusa como erro de hidratação.
  const [year, setYear] = useState(anoCorrente);

  useEffect(() => {
    const sync = () => setYear(ler());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const escolher = useCallback((y: number) => {
    try {
      localStorage.setItem(KEY, String(y));
    } catch {
      /* modo privado — a escolha só não persiste */
    }
    // Evento e não só `setYear`: as outras telas do RH abertas noutra aba
    // reagem juntas, e o seletor de semana relê o total de semanas do ano.
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [year, escolher];
}
