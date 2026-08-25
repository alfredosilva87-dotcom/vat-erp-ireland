/**
 * O exercício fiscal — o ano-base em que se está trabalhando.
 *
 * Um sistema contábil trabalha dentro de um ano; até aqui esse ano vivia
 * dentro de cada tela e se perdia ao trocar de rotina — o contador escolhia
 * 2025 no painel, ia às obrigações e voltava a 2026 sem perceber.
 *
 * Mesmo formato de `lib/currentClient.ts`: localStorage + evento, para as
 * telas abertas reagirem juntas sem precisar de um provider global.
 */
const KEY = "vat.exercise";
export const EXERCISE_EVENT = "exercise-changed";

/** O ano corrente quando nada foi escolhido ainda. */
export const defaultExercise = () => new Date().getFullYear();

export function getExercise(): number {
  if (typeof window === "undefined") return defaultExercise();
  const raw = localStorage.getItem(KEY);
  const n = raw ? Number(raw) : NaN;
  // Ano fora de uma faixa plausível é lixo (chave adulterada, valor antigo):
  // cair no ano corrente é melhor que consultar um período que não existe.
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : defaultExercise();
}

export function setExercise(year: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, String(year));
  window.dispatchEvent(new Event(EXERCISE_EVENT));
}

/** Os anos oferecidos no seletor: o próximo, o corrente e dois anteriores. */
export function exerciseOptions(current = defaultExercise()): number[] {
  return [current + 1, current, current - 1, current - 2];
}
