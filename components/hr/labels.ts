"use client";

import type { TKey } from "@/lib/i18n";

/**
 * Os valores que vieram GUARDADOS em inglês, escritos no idioma da tela.
 *
 * O sistema do Matheus era só em inglês, então "Thursday" e "Client sends
 * information" estão no banco como texto, não como código. Traduzir na
 * gravação seria pior: mudaria o dado por causa da tela, e um escritório que
 * troque de idioma passaria a ter as duas versões na mesma coluna.
 *
 * Então traduz-se na SAÍDA, e o que não se reconhece passa como está — um
 * valor novo aparece em inglês, que é feio, mas aparece; um `??` mal posto
 * mostraria um traço no lugar de um dia da semana.
 */

const DIAS: Record<string, number> = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 0,
};

/** Dia da semana pelo `Intl`: doze palavras que o sistema já sabe dizer. */
export function diaDaSemana(valor: string | null, lang: string): string {
  if (!valor) return "—";
  const n = DIAS[valor.trim().toLowerCase()];
  if (n === undefined) return valor;
  // 2024-01-01 foi uma segunda-feira: serve de âncora para qualquer dia.
  const d = new Date(Date.UTC(2024, 0, 1 + ((n + 6) % 7)));
  const nome = d.toLocaleDateString(lang, { weekday: "long", timeZone: "UTC" });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

const ORIGENS: Record<string, TKey> = {
  "client sends information": "hr.sourceClient",
  "same every payroll": "hr.sourceFixed",
  // A grafia antiga, antes de o próprio sistema dele renomear o valor. Bases
  // que nunca correram aquela migração ainda a têm.
  "fixed every payroll": "hr.sourceFixed",
};

export function origemDasHoras(valor: string | null, t: (k: TKey) => string): string {
  if (!valor) return "—";
  const k = ORIGENS[valor.trim().toLowerCase()];
  return k ? t(k) : valor;
}
