/**
 * A paleta dos ficheiros que o escritório entrega — Excel e PDF.
 *
 * Uma definição só, em `#RRGGBB`, e as duas conversões saem dela: o ExcelJS
 * quer `AARRGGBB` e o pdf-lib quer três frações de 0 a 1. Enquanto cada
 * ficheiro escrevia o seu hex à mão, um balanço em PDF e um em Excel do mesmo
 * cliente saíam com violetas diferentes, e ninguém repara nisso até ver os
 * dois lado a lado em cima da mesa.
 *
 * As cores são as do ERP (ver `app/globals.css`) — a referência que o Alfredo
 * mandou é azul-marinho e copia-se dela o DESENHO, nunca a cor.
 */

export const PALETA = {
  primary: "#1D1740",     // violeta profundo — faixas de cabeçalho
  primaryMed: "#2F2860",
  accent: "#7C5CFF",      // violeta da marca — valores de KPI, destaques
  accentSoft: "#EFEBFF",
  success: "#159A6B",
  successSoft: "#E6F5EF",
  danger: "#DC2626",
  dangerSoft: "#FDEBEB",
  warning: "#D97706",
  warningSoft: "#FCF1E2",
  surface: "#FFFFFF",
  bg: "#F6F5FC",
  border: "#E7E4F3",
  text: "#1A1533",
  muted: "#6B6590",
  rowAlt: "#F5F3FD",
} as const;

export type CorDaMarca = keyof typeof PALETA;

/** `#1D1740` → `FF1D1740`, que é o que o ExcelJS espera. */
export const argb = (cor: CorDaMarca): string => "FF" + PALETA[cor].slice(1);

/** As cores no formato do ExcelJS, com os mesmos nomes de sempre. */
export const C: Record<CorDaMarca, string> = Object.fromEntries(
  (Object.keys(PALETA) as CorDaMarca[]).map((k) => [k, argb(k)])
) as Record<CorDaMarca, string>;

/**
 * `#1D1740` → `{ r: 0.113, g: 0.090, b: 0.251 }`, que é o que o pdf-lib pede.
 *
 * Devolve o objeto cru e não `rgb()` do pdf-lib de propósito: este ficheiro é
 * partilhado com o Excel, e importar pdf-lib aqui arrastaria o gerador de PDF
 * inteiro para dentro de quem só quer uma folha de cálculo.
 */
export const rgbDe = (cor: CorDaMarca): { r: number; g: number; b: number } => {
  const h = PALETA[cor];
  return {
    r: parseInt(h.slice(1, 3), 16) / 255,
    g: parseInt(h.slice(3, 5), 16) / 255,
    b: parseInt(h.slice(5, 7), 16) / 255,
  };
};

/** O formato de número dos valores em euros, igual nos dois formatos. */
export const FORMATO_MOEDA = "#,##0.00;(#,##0.00)";

/**
 * Número em euros como se escreve num relatório: negativo entre parênteses.
 *
 * É a convenção contábil, e não enfeite — num extrato longo o sinal de menos
 * à esquerda desaparece contra o dígito seguinte, e um passivo lido como ativo
 * é o erro que a convenção existe para evitar.
 */
export const moeda = (v: number, casas = 2): string => {
  const n = Math.abs(v).toLocaleString("en-IE", {
    minimumFractionDigits: casas, maximumFractionDigits: casas,
  });
  return v < 0 ? `(${n})` : n;
};

/** Variação com sinal: `+12,4%` ou `-3,1 pp`. Nulo vira travessão. */
export const variacaoTexto = (v: number | null, emPontos = false): string => {
  if (v === null || !Number.isFinite(v)) return "—";
  const sinal = v > 0 ? "+" : "";
  return `${sinal}${v.toFixed(1)}${emPontos ? " pp" : "%"}`;
};
