import "server-only";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { PALETA, rgbDe, moeda, variacaoTexto, type CorDaMarca } from "@/lib/reportBrand";

/**
 * As peças de desenho do relatório contábil em PDF.
 *
 * Existe porque o `exportDocs` passou a desenhar timbre, faixas, cartões e
 * gráficos, e misturar isso com a montagem das demonstrações daria um ficheiro
 * onde a regra contábil e a espessura de uma linha vivem no mesmo parágrafo.
 * Aqui só há geometria; nenhuma decisão de contabilidade.
 *
 * Os gráficos são desenhados com retângulos e linhas do próprio pdf-lib, e não
 * gerados como imagem. Saem vetoriais — legíveis com zoom e na impressora — e
 * não obrigam a instalar um motor de gráficos com navegador embutido dentro de
 * uma rota de servidor.
 */

export const A4 = { w: 595.28, h: 841.89 };
export const MARGEM = 44;
export const LARGURA = A4.w - MARGEM * 2;

const cor = (c: CorDaMarca) => {
  const { r, g, b } = rgbDe(c);
  return rgb(r, g, b);
};

export type Fontes = { normal: PDFFont; negrito: PDFFont };

/**
 * O texto vai para fontes WinAnsi, que não escrevem tudo o que um nome de
 * conta pode trazer. `drawText` REBENTA nesses casos em vez de ignorar — então
 * limpa-se antes, e o relatório sai com um acento a menos em vez de não sair.
 */
export const ascii = (s: string, max = 90): string =>
  String(s ?? "")
    .replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/[·•]/g, "-").replace(/€/g, "EUR ")
    .replace(/[^\x20-\x7E]/g, "").slice(0, max);

// --------------------------------------------------------------- a folha

/**
 * A folha com um cursor.
 *
 * O cursor sabe quebrar sozinho, e é isso que impede o erro mais chato deste
 * tipo de código: uma tabela longa que continua a desenhar por baixo do fim da
 * página, invisível e sem aviso nenhum.
 */
export class Folha {
  pdf!: PDFDocument;
  pagina!: PDFPage;
  f!: Fontes;
  y = 0;
  /** Desenhado no topo de cada página nova (o timbre). */
  private topo: ((folha: Folha) => void) | null = null;
  paginas = 0;

  static async criar(): Promise<Folha> {
    const s = new Folha();
    s.pdf = await PDFDocument.create();
    s.f = {
      normal: await s.pdf.embedFont(StandardFonts.Helvetica),
      negrito: await s.pdf.embedFont(StandardFonts.HelveticaBold),
    };
    return s;
  }

  aoAbrirPagina(fn: (folha: Folha) => void) { this.topo = fn; }

  novaPagina(): this {
    this.pagina = this.pdf.addPage([A4.w, A4.h]);
    this.paginas++;
    this.y = A4.h - MARGEM;
    if (this.topo) this.topo(this);
    return this;
  }

  /** Garante espaço; abre página nova se não couber. */
  espaco(altura: number): this {
    if (this.y - altura < MARGEM + 26) this.novaPagina();
    return this;
  }

  avanca(n: number): this { this.y -= n; return this; }

  // ------------------------------------------------------------- primitivas

  faixa(x: number, y: number, largura: number, altura: number, c: CorDaMarca): this {
    this.pagina.drawRectangle({ x, y, width: largura, height: altura, color: cor(c) });
    return this;
  }

  contorno(x: number, y: number, largura: number, altura: number, c: CorDaMarca, espessura = 0.7): this {
    this.pagina.drawRectangle({
      x, y, width: largura, height: altura,
      borderColor: cor(c), borderWidth: espessura,
    });
    return this;
  }

  regua(y: number, c: CorDaMarca = "border", espessura = 0.7, de = MARGEM, ate = A4.w - MARGEM): this {
    this.pagina.drawLine({
      start: { x: de, y }, end: { x: ate, y },
      thickness: espessura, color: cor(c),
    });
    return this;
  }

  texto(t: string, x: number, y: number, o: {
    size?: number; bold?: boolean; c?: CorDaMarca; max?: number;
  } = {}): this {
    this.pagina.drawText(ascii(t, o.max ?? 90), {
      x, y, size: o.size ?? 9, font: o.bold ? this.f.negrito : this.f.normal,
      color: cor(o.c ?? "text"),
    });
    return this;
  }

  /**
   * A largura do texto TAL COMO VAI SER DESENHADO.
   *
   * O `max` tem de ser o mesmo do `texto()` que vai desenhar, senão mede-se
   * uma coisa e escreve-se outra. Media-se antes com o `max` por omissão (90
   * caracteres), e isso fazia duas coisas erradas ao mesmo tempo: alinhava mal
   * à direita qualquer texto mais longo, e — pior — o `paragrafo()` nunca
   * quebrava linha, porque a largura media sempre 90 caracteres e nunca
   * chegava a passar da margem.
   */
  larguraDe(t: string, size: number, bold = false, max = 90): number {
    return (bold ? this.f.negrito : this.f.normal).widthOfTextAtSize(ascii(t, max), size);
  }

  /** Texto encostado à direita de `xDireita`. */
  textoDireita(t: string, xDireita: number, y: number, o: {
    size?: number; bold?: boolean; c?: CorDaMarca; max?: number;
  } = {}): this {
    const size = o.size ?? 9;
    return this.texto(t, xDireita - this.larguraDe(t, size, o.bold, o.max), y, { ...o, size });
  }

  textoCentrado(t: string, centro: number, y: number, o: {
    size?: number; bold?: boolean; c?: CorDaMarca; max?: number;
  } = {}): this {
    const size = o.size ?? 9;
    return this.texto(t, centro - this.larguraDe(t, size, o.bold, o.max) / 2, y, { ...o, size });
  }

  /**
   * Texto que QUEBRA dentro de uma largura, em vez de ser cortado.
   *
   * O `texto()` corta no `max` e não avisa — o que numa etiqueta é aceitável e
   * numa frase é um defeito: sai meia palavra no fim da linha e o leitor fica
   * sem a parte que explicava. Aqui mede-se palavra a palavra e passa-se à
   * linha seguinte.
   *
   * Devolve o `y` depois da última linha, para quem precisa continuar abaixo.
   */
  paragrafo(t: string, x: number, y: number, largura: number, o: {
    size?: number; bold?: boolean; c?: CorDaMarca; entrelinha?: number;
  } = {}): number {
    const size = o.size ?? 7.5;
    const salto = o.entrelinha ?? size + 2.5;
    const palavras = ascii(t, 4000).split(/\s+/).filter(Boolean);
    let linha = "";
    let atual = y;

    const despejar = () => {
      if (!linha) return;
      this.texto(linha, x, atual, { ...o, size, max: 4000 });
      atual -= salto;
      linha = "";
    };

    for (const palavra of palavras) {
      const tentativa = linha ? `${linha} ${palavra}` : palavra;
      if (linha && this.larguraDe(tentativa, size, o.bold, 4000) > largura) {
        despejar();
        linha = palavra;
        continue;
      }
      linha = tentativa;
    }
    despejar();
    return atual;
  }

  async bytes() { return Uint8Array.from(await this.pdf.save()); }
}

// ------------------------------------------------------------------ peças

export type DadosDoTimbre = {
  firma: string;
  linhas: string[];
  cliente: string;
  identificacao: string[];
};

/** O timbre: faixa, escritório à esquerda, cliente à direita. */
export function timbre(s: Folha, d: DadosDoTimbre): void {
  s.faixa(0, A4.h - 8, A4.w, 8, "primary");
  s.faixa(0, A4.h - 11, A4.w, 3, "accent");

  let y = A4.h - 30;
  s.texto(d.firma, MARGEM, y, { size: 12.5, bold: true, c: "primary", max: 50 });
  s.textoDireita(d.cliente, A4.w - MARGEM, y, { size: 10.5, bold: true, c: "text", max: 46 });

  y -= 11;
  const alturaLinha = 9.5;
  const n = Math.max(d.linhas.length, d.identificacao.length);
  for (let i = 0; i < n; i++) {
    if (d.linhas[i]) s.texto(d.linhas[i], MARGEM, y, { size: 7.5, c: "muted", max: 70 });
    if (d.identificacao[i]) s.textoDireita(d.identificacao[i], A4.w - MARGEM, y, { size: 7.5, c: "muted", max: 50 });
    y -= alturaLinha;
  }

  s.regua(y + 3, "border");
  s.y = y - 12;
}

/** O rodapé: régua, nota e número de página. */
export function rodape(s: Folha, nota: string, numero: number): void {
  s.regua(MARGEM - 8, "border", 0.6);
  s.texto(nota, MARGEM, MARGEM - 19, { size: 7, c: "muted", max: 110 });
  s.textoDireita(String(numero), A4.w - MARGEM, MARGEM - 19, { size: 7, c: "muted" });
  s.faixa(0, 0, A4.w, 5, "primary");
}

/** O bloco de título de um relatório. */
export function tituloDoRelatorio(s: Folha, titulo: string, subtitulo: string, unidade: string): void {
  s.espaco(58);
  s.texto(titulo.toUpperCase(), MARGEM, s.y, { size: 17, bold: true, c: "primary", max: 60 });
  s.avanca(15);
  s.texto(subtitulo, MARGEM, s.y, { size: 9.5, c: "text", max: 80 });
  s.avanca(11);
  s.texto(unidade, MARGEM, s.y, { size: 8, c: "muted", max: 60 });
  s.avanca(16);
}

/** A faixa escura que abre uma seção. */
export function faixaDeSecao(s: Folha, titulo: string, colunas: string[] = []): void {
  const ALTURA = 19;
  s.espaco(ALTURA + 8);
  const y = s.y - ALTURA + 5;
  s.faixa(MARGEM, y, LARGURA, ALTURA, "primary");
  s.texto(titulo, MARGEM + 9, y + 6, { size: 9.5, bold: true, c: "surface", max: 60 });

  // Os cabeçalhos das colunas de valor vivem DENTRO da faixa: fora dela
  // precisariam de uma segunda linha e o relatório ganharia um degrau
  // horizontal a cada seção.
  colunas.forEach((c, i) => {
    s.textoDireita(c, colunaDireita(colunas.length, i), y + 6, { size: 8, bold: true, c: "surface" });
  });
  s.y = y - 9;
}

/** Onde acaba a coluna de valor `i`, contando da esquerda. */
export function colunaDireita(total: number, i: number): number {
  const LARGURA_COLUNA = 92;
  const direita = A4.w - MARGEM - 8;
  return direita - (total - 1 - i) * LARGURA_COLUNA;
}

export type LinhaDeTabela = {
  label: string;
  valores: (number | null)[];
  /** Linha somada — fundo claro e negrito. */
  destaque?: boolean;
  /** Faixa escura de total. */
  total?: boolean;
  nivel?: number;
  /** Texto solto na última coluna, em vez de número (a variação). */
  texto?: string | null;
};

/** Uma linha de demonstração, com as suas colunas de valor. */
export function linhaDeTabela(s: Folha, l: LinhaDeTabela, colunas: number, zebra = false): void {
  /*
   * A faixa ocupa exatamente a altura da linha e o cursor desce o mesmo tanto.
   * Enquanto sobrava folga, a faixa da linha seguinte subia por cima da
   * anterior e cortava-lhe os descendentes — saía um risco a meio de cada
   * "Creditors: amounts falling due..." que parecia rasura.
   */
  const ALTURA = l.total ? 18 : 14;
  s.espaco(ALTURA);
  const y = s.y - ALTURA;

  if (l.total) s.faixa(MARGEM, y, LARGURA, ALTURA, "primaryMed");
  else if (l.destaque) s.faixa(MARGEM, y, LARGURA, ALTURA, "accentSoft");
  else if (zebra) s.faixa(MARGEM, y, LARGURA, ALTURA, "rowAlt");

  const tinta: CorDaMarca = l.total ? "surface" : "text";
  const size = l.total ? 9.5 : 9;
  const bold = Boolean(l.total || l.destaque);

  s.texto(l.label, MARGEM + 9 + (l.nivel ?? 0) * 13, y + (l.total ? 6 : 4), {
    size, bold, c: tinta, max: 62,
  });

  l.valores.forEach((v, i) => {
    if (v === null) {
      s.textoDireita("-", colunaDireita(colunas, i), y + (l.total ? 6 : 4), { size, c: l.total ? "surface" : "muted" });
      return;
    }
    s.textoDireita(moeda(v), colunaDireita(colunas, i), y + (l.total ? 6 : 4), { size, bold, c: tinta });
  });

  if (l.texto !== undefined && l.texto !== null) {
    s.textoDireita(l.texto, colunaDireita(colunas, l.valores.length), y + (l.total ? 6 : 4), {
      size: 8.5, bold, c: l.total ? "surface" : "muted",
    });
  }

  s.y = y;
}

// ------------------------------------------------------------------- KPIs

export type CartaoKpi = {
  label: string;
  valor: string;
  variacao: number | null;
  emPontos?: boolean;
  /** Substitui a percentagem quando ela nao diria nada de util. */
  nota?: string | null;
};

/** A fila de cartões de KPI. */
export function cartoesKpi(s: Folha, cartoes: CartaoKpi[]): void {
  if (cartoes.length === 0) return;
  const ALTURA = 54;
  const VAO = 9;
  s.espaco(ALTURA + 12);
  const largura = (LARGURA - VAO * (cartoes.length - 1)) / cartoes.length;
  const y = s.y - ALTURA;

  cartoes.forEach((k, i) => {
    const subiu = (k.variacao ?? 0) >= 0;
    const x = MARGEM + i * (largura + VAO);
    s.faixa(x, y, largura, ALTURA, "surface");
    s.contorno(x, y, largura, ALTURA, "border");
    // A barra de topo é o que distingue um cartão de uma caixa: dá-lhe um
    // lado "de cima" sem precisar de sombra, que em PDF nunca sai bem.
    s.faixa(x, y + ALTURA - 3, largura, 3, "accent");

    s.texto(k.label, x + 9, y + ALTURA - 16, { size: 7.5, c: "muted", max: 26 });
    s.texto(k.valor, x + 9, y + 20, { size: 15, bold: true, c: "primary", max: 18 });

    if (k.variacao !== null) {
      // Sem seta: as fontes WinAnsi do pdf-lib nao tem os triangulos, e o
      // "^"/"v" que sobrava lia-se como letra. O sinal e a cor ja dizem tudo.
      const texto = variacaoTexto(k.variacao, k.emPontos);
      s.texto(texto, x + 9, y + 8, {
        size: 8, bold: true, c: subiu ? "success" : "danger", max: 20,
      });
      s.texto("vs prior year", x + 9 + s.larguraDe(texto, 8, true) + 6, y + 8, {
        size: 6.5, c: "muted", max: 16,
      });
    } else if (k.nota) {
      s.texto(k.nota, x + 9, y + 8, { size: 7.5, bold: true, c: "danger", max: 24 });
    } else {
      s.texto("no comparative", x + 9, y + 8, { size: 6.5, c: "muted", max: 20 });
    }
  });

  s.y = y - 14;
}

// --------------------------------------------------------------- gráficos

export type Serie = { rotulo: string; valor: number }[];

/**
 * Gráfico de barras, com linha de base no zero.
 *
 * A base é o zero e não o menor valor: um lucro negativo tem de aparecer ABAIXO
 * da linha. Escalar entre o mínimo e o máximo faria o pior ano da empresa
 * desenhar-se como uma barra pequena e positiva, que é uma mentira gráfica.
 */
export function graficoBarras(
  s: Folha, x: number, y: number, largura: number, altura: number,
  titulo: string, serie: Serie, corBarra: CorDaMarca = "accent"
): void {
  s.texto(titulo, x, y + altura + 6, { size: 8.5, bold: true, c: "primary", max: 34 });
  s.contorno(x, y, largura, altura, "border", 0.6);
  if (serie.length === 0) return;

  const topo = Math.max(0, ...serie.map((p) => p.valor));
  const fundo = Math.min(0, ...serie.map((p) => p.valor));
  const amplitude = topo - fundo || 1;
  const dentro = { x: x + 10, y: y + 18, w: largura - 20, h: altura - 34 };
  const zeroY = dentro.y + ((0 - fundo) / amplitude) * dentro.h;

  s.pagina.drawLine({
    start: { x: dentro.x, y: zeroY }, end: { x: dentro.x + dentro.w, y: zeroY },
    thickness: 0.6, color: cor("border"),
  });

  const passo = dentro.w / serie.length;
  const larguraBarra = Math.min(38, passo * 0.55);
  serie.forEach((p, i) => {
    const centro = dentro.x + passo * (i + 0.5);
    const h = (Math.abs(p.valor) / amplitude) * dentro.h;
    const negativo = p.valor < 0;
    s.faixa(centro - larguraBarra / 2, negativo ? zeroY - h : zeroY, larguraBarra, h || 0.5,
      negativo ? "danger" : corBarra);
    /*
     * O valor de uma barra negativa vai ACIMA da linha do zero, e nao por
     * baixo da barra: por baixo ele aterra em cima do rotulo do ano, e num
     * ano de prejuizo — que e justamente o que se quer ler — os dois numeros
     * ficam um sobre o outro. Acima do zero aquele espaco esta livre, porque
     * a barra desce.
     */
    s.textoCentrado(moeda(p.valor, 0), centro, negativo ? zeroY + 4 : zeroY + h + 3, {
      size: 6.5, bold: true, c: negativo ? "danger" : "text",
    });
    s.textoCentrado(p.rotulo, centro, y + 6, { size: 7, c: "muted" });
  });
}

/** Gráfico de linha, para a série de margem. */
export function graficoLinha(
  s: Folha, x: number, y: number, largura: number, altura: number,
  titulo: string, serie: Serie, sufixo = "%"
): void {
  s.texto(titulo, x, y + altura + 6, { size: 8.5, bold: true, c: "primary", max: 34 });
  s.contorno(x, y, largura, altura, "border", 0.6);
  if (serie.length === 0) return;

  const topo = Math.max(0, ...serie.map((p) => p.valor));
  const fundo = Math.min(0, ...serie.map((p) => p.valor));
  const amplitude = topo - fundo || 1;
  const dentro = { x: x + 14, y: y + 18, w: largura - 28, h: altura - 34 };
  const zeroY = dentro.y + ((0 - fundo) / amplitude) * dentro.h;
  s.pagina.drawLine({
    start: { x: dentro.x, y: zeroY }, end: { x: dentro.x + dentro.w, y: zeroY },
    thickness: 0.6, color: cor("border"),
  });

  const passo = serie.length > 1 ? dentro.w / (serie.length - 1) : 0;
  const ponto = (i: number) => ({
    x: dentro.x + (serie.length > 1 ? passo * i : dentro.w / 2),
    y: dentro.y + ((serie[i].valor - fundo) / amplitude) * dentro.h,
  });

  for (let i = 1; i < serie.length; i++) {
    s.pagina.drawLine({
      start: ponto(i - 1), end: ponto(i), thickness: 1.6, color: cor("accent"),
    });
  }
  serie.forEach((p, i) => {
    const q = ponto(i);
    s.pagina.drawCircle({ x: q.x, y: q.y, size: 2.6, color: cor("accent") });
    s.textoCentrado(`${p.valor.toFixed(1)}${sufixo}`, q.x, q.y + 6, { size: 6.5, bold: true, c: "primary" });
    s.textoCentrado(p.rotulo, q.x, y + 6, { size: 7, c: "muted" });
  });
}

// ----------------------------------------------------------- assinaturas

/** Os dois blocos de assinatura no fim das demonstrações. */
export function blocosDeAssinatura(
  s: Folha, esquerda: { nome: string; papel: string }, direita: { nome: string; papel: string }
): void {
  s.espaco(56);
  s.avanca(20);
  const y = s.y;
  const largura = (LARGURA - 40) / 2;
  [[MARGEM, esquerda], [MARGEM + largura + 40, direita]].forEach(([x, b]: any) => {
    s.regua(y, "muted", 0.7, x, x + largura - 20);
    // Sem nome, a linha fica em branco para se assinar a caneta. Um travessao
    // parece um campo preenchido com "nada" e nao um sitio para assinar.
    if (b.nome) s.texto(b.nome, x, y - 11, { size: 8.5, bold: true, max: 40 });
    s.texto(b.papel, x, y - 21, { size: 7.5, c: "muted", max: 46 });
  });
  s.y = y - 30;
}

export { PALETA };
