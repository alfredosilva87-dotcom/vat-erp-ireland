/**
 * LER AS HORAS DE UMA MENSAGEM ESCRITA POR UMA PESSOA.
 *
 * ---------------------------------------------------------------------------
 * O PROBLEMA REAL
 *
 * As horas de vários clientes chegam por WhatsApp, escritas à mão por quem
 * gere a loja. Não há formulário, não há formato, e não vai haver: quem manda
 * são donos de restaurantes e cabeleireiros a escrever do telemóvel, ao domingo
 * à noite. O que chega é isto:
 *
 *     Boa noite! Semana 36
 *     João 39
 *     Maria - 42.5h
 *     Pedro 38 (4 domingo)
 *     A Ana não trabalhou esta semana
 *
 * Alguém tem de transformar isso em linhas. Hoje é o Matheus, a ler e a
 * escrever. O que este módulo faz é a primeira leitura — e deixa a conferência
 * onde ela tem de estar, numa pessoa.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE MANDA EM TUDO: NA DÚVIDA, NÃO ADIVINHAR
 *
 * Uma linha que não se percebe **não vira zero horas** e não desaparece: fica
 * marcada como não lida, com o texto original. Um zero inventado é um salário
 * a menos, e ninguém vai à procura de uma linha que nunca apareceu.
 *
 * É por isso que a saída tem sempre duas listas — o que se leu e o que não se
 * leu — e nunca só a primeira.
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO ESCREVE NAS HORAS OFICIAIS
 *
 * O destino é a fila `hr_hour_submissions`, que já existe e já tem aprovação: o
 * que o cliente manda é um PEDIDO de lançamento e fica fora de toda a conta até
 * alguém do escritório aprovar. Uma leitura errada, no pior caso, produz uma
 * linha errada nessa fila — nunca um recibo errado.
 */

export interface LinhaLida {
  /** O nome como veio escrito. O casamento com o funcionário é outro passo. */
  nome: string;
  /**
   * O TOTAL da semana, tal como a pessoa o escreveu.
   *
   * Em `Pedro 38 (4 domingo)` isto é 38 — as 38 incluem as 4. É o número que se
   * mostra ao lado da mensagem original, para quem confere reconhecer o que leu.
   */
  horas: number | null;
  /**
   * O que vai para a coluna `hours` da base — o total MENOS o que já tem coluna
   * própria. Ver a nota extensa em `separarOTotal`: aqui as colunas somam-se, e
   * escrever 38 e 4 daria 42.
   */
  horasNormais: number | null;
  horasDomingo: number | null;
  horasFeriado: number | null;
  /** `false` quando a mensagem diz explicitamente que não trabalhou. */
  trabalhou: boolean;
  /** Chave de aviso quando as contas da linha não fecham. Nunca uma frase. */
  aviso: string | null;
  /** A linha original, para quem confere poder comparar. */
  origem: string;
}

export interface Leitura {
  /** A semana, quando a mensagem a diz. Nulo obriga quem confere a escolhê-la. */
  semana: number | null;
  linhas: LinhaLida[];
  /** O que não se conseguiu ler. Nunca se deita fora. */
  naoLidas: string[];
}

/**
 * Palavras que dizem "esta pessoa não trabalhou".
 *
 * As três línguas do produto, porque quem escreve escreve na sua — e um
 * "não trabalhou" lido como "0 horas" dá no mesmo, mas um lido como
 * *não percebi* obrigaria alguém a ir ver de que se tratava.
 */
const NAO_TRABALHOU = /\b(n[ãa]o\s+trabalh|nao\s+trabalh|folga|f[ée]rias|ausente|falta|baixa|did\s*n[o']?t\s+work|off\b|holiday\s+week|no\s+trabaj)/i;

/** "domingo", "sunday", "dom" — as horas que se pagam a mais. */
const DOMINGO = /\b(domingos?|sunday|dom\.?)\b/i;
/** "feriado", "bank holiday", "festivo". */
const FERIADO = /\b(feriados?|bank\s*holiday|holiday|festivos?)\b/i;

/** "Semana 36", "sem 36", "week 36", "wk36", "S36". */
const SEMANA = /\b(?:semana|sem|week|wk|s)\s*\.?\s*(\d{1,2})\b/i;

/**
 * Um número de horas: `39`, `42.5`, `42,5`, `39h`, `8:30`.
 *
 * `8:30` é meia hora, não trinta — e escrever `8:30` é comum em quem vem de
 * um relógio de ponto. Lê-lo como `8,30` daria 8 horas e 18 minutos, uma
 * diferença pequena o suficiente para nunca ser notada.
 */
function lerNumero(bruto: string): number | null {
  const s = bruto.trim();
  const relogio = s.match(/^(\d{1,2}):([0-5]\d)$/);
  if (relogio) return Number(relogio[1]) + Number(relogio[2]) / 60;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  // Mais de 168 horas não cabe numa semana. É engano de digitação, não horas.
  if (n < 0 || n > 168) return null;
  return n;
}

/** Um número encontrado na linha, e onde ele está. */
interface Numero { valor: number; inicio: number; fim: number; }

/**
 * Todos os números de uma linha, com a posição.
 *
 * A ordem das alternativas do padrão IMPORTA: o relógio (`38:30`) vem primeiro
 * porque `\d{1,3}` casaria o `38` sozinho e o resto ficava para trás — lia-se
 * 38 horas em vez de 38 e meia, e a diferença é pequena o suficiente para nunca
 * ser notada.
 */
function numerosDe(linha: string): Numero[] {
  const out: Numero[] = [];
  const re = /(\d{1,2}:[0-5]\d|\d{1,3}(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(linha)) !== null) {
    const valor = lerNumero(m[1]);
    if (valor === null) continue;
    out.push({ valor, inicio: m.index, fim: m.index + m[0].length });
  }
  return out;
}

/**
 * A que número pertence uma etiqueta.
 *
 * ---------------------------------------------------------------------------
 * A PRIMEIRA VERSÃO ERRAVA AQUI, E O TESTE APANHOU-A
 *
 * Ela olhava para uma janela de 18 caracteres à volta de cada número. Em
 * `Pedro 38 (4 domingo)`, o `38` via "domingo" dentro dessa janela e reclamava
 * a etiqueta para si: o total ia para a coluna do domingo e as horas normais
 * ficavam vazias. Silenciosamente, e num número plausível.
 *
 * A regra certa é de PROXIMIDADE: a etiqueta pertence ao número mais próximo
 * dela, e nenhum número pode ser reclamado duas vezes. Em `38 (4 domingo)`, o
 * `4` está a três caracteres e o `38` a onze — o `4` ganha, que é o que a
 * pessoa quis dizer.
 */
function maisPertoDe(
  pos: number, fimDoRotulo: number, nums: Numero[], jaUsados: Set<number>
): number | null {
  /*
   * ---------------------------------------------------------------------------
   * A PROXIMIDADE SOZINHA NÃO CHEGA, E ISTO TAMBÉM SAIU DO TESTE
   *
   * As pessoas escrevem das duas maneiras, e as duas são naturais:
   *
   *     Pedro 38 (4 domingo)     ← o número vem ANTES da etiqueta
   *     Tiago 40 domingo 8       ← o número vem DEPOIS
   *
   * Em `40 domingo 8`, o mais próximo de "domingo" é o `40` — e ficaria com o
   * total na coluna do domingo. Mas quem escreveu quis dizer "domingo: 8": a
   * etiqueta seguida de dois pontos implícitos.
   *
   * Então a regra é em duas passagens: se houver número LOGO A SEGUIR à
   * etiqueta, é esse; senão, o mais próximo. Cobre as duas maneiras sem casos
   * especiais para nenhuma.
   */
  const logoASeguir = nums.findIndex(
    (n, i) => !jaUsados.has(i) && n.inicio >= fimDoRotulo && n.inicio - fimDoRotulo <= 4
  );
  if (logoASeguir >= 0) return logoASeguir;

  let melhor: number | null = null;
  let dist = Infinity;
  nums.forEach((n, i) => {
    if (jaUsados.has(i)) return;
    // Distância do rótulo ao número, pela borda mais próxima.
    const d = pos >= n.fim ? pos - n.fim : n.inicio >= pos ? n.inicio - pos : 0;
    if (d < dist) { dist = d; melhor = i; }
  });
  // Longe de mais não é uma etiqueta daquele número: é outra coisa na frase.
  return dist <= 14 ? melhor : null;
}

/**
 * O nome é o que sobra depois de tirar os números e a pontuação de ligação.
 *
 * Deduzir o nome em vez de o exigir num formato é o que permite ler as
 * mensagens como elas são. Um nome vazio faz a linha cair em `naoLidas` — não
 * se inventa "Funcionário 1".
 */
function nomeDe(linha: string): string {
  return linha
    .replace(/\d{1,3}(?:[.,]\d{1,2})?|\d{1,2}:[0-5]\d/g, " ")
    .replace(/\b(h|hs|hrs|horas?|hours?|domingos?|sunday|dom\.?|feriados?|bank\s*holiday|holiday|festivos?)\b/gi, " ")
    .replace(/[-–—:;,.()\[\]•*]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Linhas que são saudação ou despedida, e não dados. */
const RUIDO = /^(bo[am]\s|ol[áa]\b|oi\b|hi\b|hello\b|obrigad|thanks?\b|abra[çc]o|cumprimentos|segue|aqui\s+v[ãa]o|boa\s+noite|bom\s+dia)/i;

/**
 * O TOTAL NÃO É UMA PARCELA — e confundir os dois inflacionava o salário.
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO, QUE FUI EU QUE O PUS CÁ
 *
 * `Pedro 38 (4 domingo)` lia-se como `horas = 38` e `domingo = 4`. Ambos os
 * números certos, e o resultado errado: neste sistema as duas colunas **somam-se**
 * no bruto — `horas × taxa + domingo × taxaDomingo` —, portanto o Pedro passava a
 * ter 42 horas pagas. Quatro a mais, todas as semanas, com o prémio de domingo
 * por cima.
 *
 * E era invisível: 42 é um número plausível para uma semana de trabalho. Ninguém
 * o vai contestar a olhar para o recibo.
 *
 * ---------------------------------------------------------------------------
 * A REGRA, E O QUE ELA ASSUME
 *
 * Quem escreve `38 (4 domingo)` está a dizer "38 no total, das quais 4 ao
 * domingo". O número solto é o TOTAL da semana, e os etiquetados são partes
 * dele. Então o que vai para a coluna das horas normais é `total − etiquetadas`.
 *
 * ---------------------------------------------------------------------------
 * E QUANDO A CONTA NÃO FECHA
 *
 * `Pedro 4 domingo 8` — o "total" é menor do que a parte. Aí a suposição está
 * errada e não há maneira de saber qual: pode ser alguém a somar (4 normais + 8
 * de domingo), pode ser um engano de digitação. **Não se corrige nada**: ficam os
 * números como vieram e a linha leva um aviso, para quem aprova a fila decidir.
 * Inventar aqui seria repetir o defeito ao contrário.
 */
export function separarOTotal(
  total: number | null, domingo: number | null, feriado: number | null
): { horasNormais: number | null; aviso: string | null } {
  const partes = (domingo ?? 0) + (feriado ?? 0);
  if (total === null) return { horasNormais: null, aviso: null };
  if (partes <= 0) return { horasNormais: total, aviso: null };
  if (total < partes) return { horasNormais: total, aviso: "wa.somaNaoBate" };
  return { horasNormais: Math.round((total - partes) * 100) / 100, aviso: null };
}

/**
 * Lê a mensagem inteira.
 *
 * Não tenta ser esperta: percorre linha a linha, e cada linha que tenha um nome
 * e pelo menos um número vira uma leitura. O resto fica de fora, à vista.
 */
export function lerHorasDeTexto(texto: string): Leitura {
  const bruto = String(texto ?? "");
  const semanaM = bruto.match(SEMANA);
  const semana = semanaM ? Number(semanaM[1]) : null;

  const linhas: LinhaLida[] = [];
  const naoLidas: string[] = [];

  for (const cru of bruto.split(/\r?\n/)) {
    const linha = cru.trim();
    if (!linha) continue;
    // A linha que só diz a semana não é uma pessoa.
    if (SEMANA.test(linha) && !/[A-Za-zÀ-ÿ]{3,}\s+[A-Za-zÀ-ÿ]/.test(linha.replace(SEMANA, ""))) continue;
    if (RUIDO.test(linha)) continue;

    const nome = nomeDe(linha);
    const nums = numerosDe(linha);

    /*
     * "A Ana não trabalhou esta semana" — sem número, mas com informação.
     *
     * O NOME É O QUE VEM ANTES da expressão, e não o que sobra dela. A primeira
     * versão apagava só as palavras que casavam e ficava com os restos: dava
     * "A Ana ou esta semana", que é o tipo de lixo que passa despercebido numa
     * lista e depois não casa com funcionário nenhum. Cortar a linha no ponto
     * onde a expressão começa resolve-o de uma vez.
     */
    const m = linha.match(NAO_TRABALHOU);
    if (m && m.index !== undefined) {
      const antes = nomeDe(linha.slice(0, m.index));
      // Um artigo à frente do nome ("A Ana", "O Pedro") não é parte do nome.
      const semArtigo = antes.replace(/^(a|o|as|os|the)\s+/i, "").trim();
      if (semArtigo) {
        linhas.push({
          nome: semArtigo,
          horas: 0, horasNormais: 0, horasDomingo: null, horasFeriado: null,
          trabalhou: false, aviso: null, origem: linha,
        });
        continue;
      }
    }

    if (!nome || !nums.length) { naoLidas.push(linha); continue; }

    /*
     * Qual número é qual.
     *
     * O primeiro número sem etiqueta é o total de horas. Os que vêm ao pé de
     * "domingo" ou "feriado" são esses — e a etiqueta pode vir antes ou depois
     * (`4 domingo` e `domingo 4` escrevem-se as duas).
     */
    let horas: number | null = null;
    let domingo: number | null = null;
    let feriado: number | null = null;
    const usados = new Set<number>();

    /*
     * As ETIQUETADAS primeiro, e só depois o total.
     *
     * Se o total fosse escolhido primeiro, ele levaria o primeiro número da
     * linha — que em `Pedro 38 (4 domingo)` está certo, mas em
     * `Pedro domingo 4, total 38` estaria errado. Deixar as etiquetas
     * escolherem antes resolve os dois sem casos especiais.
     */
    for (const [padrao, atribuir] of [
      [DOMINGO, (v: number) => { domingo = v; }],
      [FERIADO, (v: number) => { feriado = v; }],
    ] as const) {
      const re = new RegExp(padrao.source, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(linha)) !== null) {
        const i = maisPertoDe(m.index, m.index + m[0].length, nums, usados);
        if (i !== null) { usados.add(i); atribuir(nums[i].valor); break; }
      }
    }

    for (let i = 0; i < nums.length; i++) {
      if (usados.has(i)) continue;
      horas = nums[i].valor;
      break;
    }

    if (horas === null && domingo === null && feriado === null) { naoLidas.push(linha); continue; }

    const { horasNormais, aviso } = separarOTotal(horas, domingo, feriado);
    linhas.push({
      nome, horas, horasNormais,
      horasDomingo: domingo, horasFeriado: feriado,
      trabalhou: true, aviso, origem: linha,
    });
  }

  return { semana, linhas, naoLidas };
}
