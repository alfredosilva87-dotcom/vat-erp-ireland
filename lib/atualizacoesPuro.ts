/**
 * Comparar versões — a regra, sem rede, para poder ser testada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO PRECISA DE EXISTIR
 *
 * O ERP passa a ser privado no GitHub e corre **na máquina do escritório**.
 * Ninguém do lado de cá vê aquela instalação: se ela ficar três meses numa
 * versão com um erro de cálculo já corrigido, não há sintoma nenhum — o
 * sistema continua a responder, e a continuar errado.
 *
 * A instalação tem de ser ela a perguntar "há coisa nova?", e a dizê-lo a quem
 * a usa.
 *
 * ---------------------------------------------------------------------------
 * A REGRA DE COMPARAÇÃO, E O QUE ELA NÃO PODE FAZER
 *
 * As etiquetas deste projecto são `v1.38`, `v1.31.1`, `v1.18.2` — semver com o
 * `patch` opcional. Duas armadilhas, e as duas já morderam projectos a sério:
 *
 *   **Comparar como texto.** `"1.9" > "1.10"` é verdade em texto e mentira em
 *   versões. O escritório ficaria preso na 1.9 para sempre, com o sistema a
 *   garantir-lhe que estava actualizado.
 *
 *   **Avisar para BAIXO.** Uma etiqueta apagada, ou uma máquina que corre uma
 *   versão mais nova do que a publicada (o meu portátil, a meio de uma
 *   entrega), não pode gerar "há actualização" — mandaria a pessoa "actualizar"
 *   para trás.
 */

export type Versao = { major: number; minor: number; patch: number };

/**
 * `v1.38` → `{1, 38, 0}`. Devolve `null` ao que não for versão.
 *
 * O `v` é opcional porque as etiquetas do git têm-no e o `package.json` não —
 * e os dois são comparados um contra o outro.
 */
export function lerVersao(bruta: string | null | undefined): Versao | null {
  if (!bruta) return null;
  const m = /^\s*v?(\d+)\.(\d+)(?:\.(\d+))?\s*$/.exec(String(bruta));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3] ?? 0) };
}

/** -1 se `a` for anterior, 0 se iguais, 1 se `a` for posterior. */
export function compararVersoes(a: Versao, b: Versao): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

export const escrever = (v: Versao) => `${v.major}.${v.minor}.${v.patch}`;

/**
 * A mais alta de uma lista de etiquetas.
 *
 * As etiquetas vêm do GitHub por ordem de CRIAÇÃO, não de versão — uma
 * `v1.31.1` publicada depois da `v1.35` (correcção numa linha antiga) apareceria
 * primeiro e passaria por "a mais recente". Por isso escolhe-se pela versão e
 * nunca pela ordem em que a lista chegou.
 */
export function maisAlta(etiquetas: string[]): { tag: string; versao: Versao } | null {
  let melhor: { tag: string; versao: Versao } | null = null;
  for (const tag of etiquetas) {
    const v = lerVersao(tag);
    if (!v) continue; // etiqueta que não é versão (`demo`, `backup-x`) ignora-se
    if (!melhor || compararVersoes(v, melhor.versao) > 0) melhor = { tag, versao: v };
  }
  return melhor;
}

export type Novidade = {
  /** Há mesmo coisa nova, e para a frente. */
  ha: boolean;
  instalada: string | null;
  disponivel: string | null;
  /** Quantas versões `minor` de distância — dá a dimensão do salto. */
  saltoMinor: number;
};

/**
 * Compara o que está instalado com o que está publicado.
 *
 * Nunca diz que há novidade quando a instalada é igual ou mais alta. Também não
 * diz nada quando não consegue ler uma das duas: uma versão ilegível é uma
 * pergunta sem resposta, e responder "actualize" a uma pergunta sem resposta é
 * pior do que ficar calado — o aviso passaria a aparecer sempre, e um aviso que
 * aparece sempre deixa de ser lido.
 */
export function compararComPublicada(instalada: string | null, publicada: string | null): Novidade {
  const a = lerVersao(instalada);
  const b = lerVersao(publicada);
  const base = {
    instalada: a ? escrever(a) : null,
    disponivel: b ? escrever(b) : null,
    saltoMinor: 0,
  };
  if (!a || !b) return { ...base, ha: false };
  if (compararVersoes(b, a) <= 0) return { ...base, ha: false };
  return {
    ...base,
    ha: true,
    // Só conta saltos dentro do mesmo `major`; entre majors a distância em
    // minors não quer dizer nada.
    saltoMinor: b.major === a.major ? b.minor - a.minor : 0,
  };
}
