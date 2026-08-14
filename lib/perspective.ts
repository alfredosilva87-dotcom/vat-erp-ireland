/**
 * A matemática do "endireitar documento" (camada B4, recorte por perspectiva).
 *
 * O usuário arrasta 4 cantos sobre a foto, marcando onde o papel realmente
 * está. Esta função descobre a transformação que leva um retângulo perfeito
 * (a saída) para dentro daquele quadrilátero torto (a foto) — não o
 * contrário — porque desenhar a saída pixel a pixel e perguntar "de onde na
 * foto original isso veio" é o único jeito de não deixar buraco na imagem
 * final. Pintar do jeito inverso (pixel de origem → onde cai no destino)
 * deixa lacunas onde nenhum pixel de origem caiu exatamente.
 *
 * Sem biblioteca de visão computacional: é álgebra linear pura, resolvendo o
 * sistema que qualquer transformação de perspectiva obedece. O risco aqui não
 * é o navegador — é a fórmula estar sutilmente errada e ninguém perceber
 * porque o resultado "roda sem erro", só sai com a imagem deformada. Por isso
 * os testes abaixo conferem contra casos que dá para calcular à mão.
 */

export interface Point {
  x: number;
  y: number;
}

/** Os 4 cantos de um quadrilátero, nesta ordem: sup-esq, sup-dir, inf-dir, inf-esq. */
export type Quad = [Point, Point, Point, Point];

/**
 * Uma transformação de perspectiva como matriz 3×3, achatada em 9 números
 * (linha a linha). `h[8]` não é sempre 1: mantido explícito em vez de
 * normalizado, porque normalizar cedo demais é onde erro de arredondamento
 * se esconde.
 */
export type Homography = number[];

const EPS = 1e-9;

/**
 * Resolve Ax = b por eliminação de Gauss com pivô parcial.
 *
 * Pivô parcial (troca de linha pela de maior valor absoluto na coluna) não é
 * enfeite: sem ele, um quadrilátero quase degenerado — 3 cantos quase
 * colineares, o usuário arrastou mal — pode fazer a eliminação dividir por um
 * número pequeno demais e devolver lixo silencioso em vez de um erro claro.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    if (Math.abs(M[pivot][col]) < EPS) return null; // quadrilátero degenerado
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * A transformação que leva os 4 cantos de `from` exatamente nos 4 cantos de
 * `to`, na mesma ordem.
 *
 * `null` quando os pontos não definem um quadrilátero de verdade — 3+ pontos
 * colineares, ou dois cantos iguais. Devolver `null` em vez de uma matriz
 * numericamente instável é a diferença entre a tela avisar "ajuste os cantos"
 * e ela silenciosamente entregar uma imagem com uma esquina esticada ao
 * infinito.
 */
export function computeHomography(from: Quad, to: Quad): Homography | null {
  // Cada correspondência (u,v) -> (x,y) dá duas equações lineares nos 8
  // coeficientes de h (h8 fixo em 1, a escala é livre numa homografia):
  //   h0*u + h1*v + h2 - h6*u*x - h7*v*x = x
  //   h3*u + h4*v + h5 - h6*u*y - h7*v*y = y
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = from[i];
    const { x, y } = to[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }
  const h = solveLinearSystem(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Aplica a homografia a um ponto, com a divisão de perspectiva. */
export function applyHomography(h: Homography, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/**
 * A homografia pronta para "pintar a saída perguntando de onde na foto cada
 * pixel veio": de um retângulo `width×height` para o quadrilátero que o
 * usuário marcou na foto.
 *
 * Existe separada de `computeHomography` porque é a composição que o
 * recorte de verdade usa, e fixar a ordem (retângulo → foto, não o
 * contrário) num nome próprio evita a troca ser feita ao contrário na hora
 * de desenhar — o erro mais fácil de cometer aqui, porque compila e roda
 * dos dois jeitos, só um deles produz uma imagem que faz sentido.
 */
export function rectToQuadHomography(width: number, height: number, quad: Quad): Homography | null {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  return computeHomography(rect, quad);
}

/**
 * O tamanho de saída sugerido a partir dos 4 cantos marcados.
 *
 * Usa a maior das duas larguras e a maior das duas alturas — um documento
 * fotografado em ângulo tem um par de lados mais curto que o outro por causa
 * da perspectiva, e a saída deve caber o lado mais generoso, não recortar
 * pela estimativa mais pessimista.
 */
export function suggestedOutputSize(quad: Quad, maxLongEdge: number): { width: number; height: number } {
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const width = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  const height = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));

  const longEdge = Math.max(width, height);
  const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * O palpite inicial dos 4 cantos, antes de a pessoa arrastar nada.
 *
 * Não é detecção de borda — é uma margem fixa a partir do quadro inteiro.
 * Bom o bastante quando a foto já está razoavelmente enquadrada, e sempre
 * arrastável para o lugar certo quando não está. Ver a decisão registrada:
 * detecção de verdade fica para depois, se a qualidade da foto pedir.
 */
export function defaultQuad(width: number, height: number, marginRatio = 0.06): Quad {
  const mx = width * marginRatio;
  const my = height * marginRatio;
  return [
    { x: mx, y: my },
    { x: width - mx, y: my },
    { x: width - mx, y: height - my },
    { x: mx, y: height - my },
  ];
}

/**
 * Um buffer de pixels RGBA — a mesma forma de `ImageData`, mas sem exigir a
 * classe do DOM. É essa diferença que deixa esta função testável fora do
 * navegador: o teste monta um objeto comum com um `Uint8ClampedArray` dentro,
 * o navegador de verdade passa o `ImageData` de um canvas, e os dois servem.
 */
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Pinta `dst` perguntando, para cada pixel de saída, de onde em `src` ele
 * veio — `toSourceH` já é a homografia "retângulo de saída → quadrilátero na
 * origem" (o que `rectToQuadHomography` devolve). Pintar assim, de trás para
 * frente, é o que garante que a saída não fica com buraco: pintar de frente
 * para trás (de onde cada pixel de origem cai no destino) deixaria lacunas
 * onde nenhum pixel de origem caiu exatamente num pixel de saída inteiro.
 *
 * Amostragem bilinear — interpola os 4 pixels vizinhos da origem — em vez do
 * pixel mais próximo: sem isso, uma linha fina de texto na nota sai
 * serrilhada, e é perceptível numa nota fiscal.
 */
export function warpQuadToRect(src: PixelBuffer, dst: PixelBuffer, toSourceH: Homography): void {
  const sw = src.width, sh = src.height;
  const sdata = src.data, ddata = dst.data;

  for (let y = 0; y < dst.height; y++) {
    for (let x = 0; x < dst.width; x++) {
      const p = applyHomography(toSourceH, { x, y });
      const oi = (y * dst.width + x) * 4;

      if (p.x < 0 || p.y < 0 || p.x > sw - 1 || p.y > sh - 1) {
        // Fora da imagem de origem: o canto marcado ficou além da borda da
        // foto. Branco, não preto — perto do que um scanner de papel faz, e
        // não uma mancha escura que pareceria dado perdido.
        ddata[oi] = 255; ddata[oi + 1] = 255; ddata[oi + 2] = 255; ddata[oi + 3] = 255;
        continue;
      }

      const x0 = Math.floor(p.x), y0 = Math.floor(p.y);
      const x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
      const fx = p.x - x0, fy = p.y - y0;

      for (let c = 0; c < 4; c++) {
        const p00 = sdata[(y0 * sw + x0) * 4 + c];
        const p10 = sdata[(y0 * sw + x1) * 4 + c];
        const p01 = sdata[(y1 * sw + x0) * 4 + c];
        const p11 = sdata[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        ddata[oi + c] = top + (bottom - top) * fy;
      }
    }
  }
}
