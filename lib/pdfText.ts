/**
 * TEXTO QUE CABE NUM PDF SEM PERDER OS ACENTOS.
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO
 *
 * O maço de documentos entregue ao cliente saía assim:
 *
 *     ZZTEST  2026-01-01  ate  2026-09-03          (era "até")
 *     Saidas:   3   EUR 615.00                     (era "Saídas")
 *     Data  Lado  Parte  Numero  Total  Doc        (era "Número")
 *     3 lancamento(s) sem ficheiro anexado         (era "lançamento(s)")
 *
 * A causa era uma linha defensiva a mais: `replace(/[^\x20-\x7E]/g, "")`, que
 * deita fora TUDO o que não é ASCII de sete bits.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ELA EXISTIA — E PORQUE ESTAVA ERRADA
 *
 * A preocupação era legítima: as fontes padrão do `pdf-lib` escrevem em
 * WinAnsi, e `drawText` **rebenta** com um caractere que a fonte não sabe
 * desenhar. Um nome de fornecedor vindo de OCR traz aspas curvas e travessões,
 * e um arquivo que não sai é pior do que um arquivo com o nome estropiado.
 *
 * Só que WinAnsi (CP1252) **não é ASCII**: sabe escrever á, ç, ã, é, ú, ó, à,
 * o travessão e as aspas curvas — precisamente os caracteres que estavam a
 * desaparecer. A guarda protegia contra um problema real deitando fora
 * exactamente o que não fazia mal nenhum.
 *
 * Então a regra passa a ser a certa: **mantém-se tudo o que o CP1252 sabe
 * escrever**; o que ele não sabe tenta-se decompor (ā → a, ł → l); e só o que
 * sobra depois disso é que cai. O arquivo continua a sair sempre — que era a
 * garantia que interessava — mas em português a sério.
 */

/**
 * Os 27 caracteres que o CP1252 põe no intervalo 0x80–0x9F, onde o Latin-1 não
 * tem nada. Estão aqui um a um porque não há regra que os gere: é uma tabela.
 */
const CP1252_ALTOS = new Set([
  "€", "‚", "ƒ", "„", "…", "†", "‡", "ˆ",
  "‰", "Š", "‹", "Œ", "Ž", "‘", "’", "“",
  "”", "•", "–", "—", "˜", "™", "š", "›",
  "œ", "ž", "Ÿ",
]);

/** O CP1252 sabe desenhar este caractere? */
export function ehWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  if (c >= 0x20 && c <= 0x7e) return true;   // ASCII imprimível
  if (c >= 0xa0 && c <= 0xff) return true;   // Latin-1: á à ã ç é í ó ú ü ñ …
  return CP1252_ALTOS.has(ch);
}

/**
 * Deixa o texto pronto para uma fonte WinAnsi, sem lhe tirar os acentos.
 *
 * `max` corta o comprimento — uma célula de tabela tem largura fixa, e um nome
 * de fornecedor de 200 caracteres passaria por cima da coluna seguinte.
 * `vazio` é o que sai quando não sobra nada.
 */
export function winAnsiSafe(s: string | null | undefined, max = 60, vazio = "-"): string {
  const bruto = String(s ?? "");
  let out = "";
  for (const ch of bruto) {
    if (ehWinAnsi(ch)) { out += ch; continue; }
    /*
     * Fora da tabela: tenta-se decompor antes de desistir.
     *
     * "ā" é A + mácron; tirado o mácron sobra "A", que é legível e verdadeiro.
     * Isto é perda de informação, mas é a perda MENOR — e só acontece a quem
     * já não cabia no ficheiro de todo.
     */
    const decomposto = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const d of decomposto) if (ehWinAnsi(d)) out += d;
  }
  // Espaços a mais tornam-se visíveis quando um caractere cai pelo meio.
  out = out.replace(/[ \t]{2,}/g, " ").trim();
  return out.slice(0, max) || vazio;
}
