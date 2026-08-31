/**
 * A MARCA DO PRODUTO, num sítio só.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UMA CONSTANTE E NÃO O NOME ESCRITO EM CADA ECRÃ
 *
 * O nome estava cravado em doze ficheiros — a barra lateral, o login, o
 * manifesto do PWA, o rodapé dos PDF, o autor dos ficheiros Excel, o texto da
 * licença. Trocá-lo obrigou a passar por todos, e o que se esquecesse ficava a
 * dizer o nome antigo num sítio onde ninguém olha até um cliente perguntar.
 *
 * A partir daqui, a próxima troca é uma linha.
 * ---------------------------------------------------------------------------
 */

export const MARCA = {
  /** O nome curto — barra lateral, título de janela, nome do PWA. */
  nome: "ACCENTRA",
  /** A linha que o acompanha. É o que o logótipo diz por baixo da marca. */
  descritor: "ERP & Accounting Platform",
  /** Nome e descritor juntos, para títulos e metadados. */
  get completo() { return `${this.nome} — ${this.descritor}`; },
  /** O símbolo quadrado (o "A"). */
  icone: "/logo.png",
  /** O logótipo deitado, com o nome ao lado. Para cabeçalhos largos. */
  lockup: "/logo-wordmark.png",
} as const;
