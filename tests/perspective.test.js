/**
 * Recorte por perspectiva (camada B4) — testes.
 *
 * Roda com `npm test`, que compila lib/perspective.ts antes.
 *
 * O comportamento que mais custa se estiver errado: a homografia devolvida
 * parece certa (roda sem erro, os 4 cantos batem por definição) mas o INTERIOR
 * da imagem sai deformado, porque a componente de perspectiva (h6/h7) ficou
 * com o sinal ou a fórmula errada. Isso não aparece em log nenhum — só numa
 * nota fiscal com as linhas de texto tortas. Por isso os testes abaixo não se
 * contentam em conferir os 4 cantos; recuperam coeficientes conhecidos de um
 * caso genuinamente não-afim e comparam número a número.
 */
const P = require("../.test-build/perspective.js");

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log("  ok   " + label); }
  else { fail++; console.log("  FALHA " + label + (extra !== undefined ? "  -> " + JSON.stringify(extra) : "")); }
};

const pt = (x, y) => ({ x, y });
const unitSquare = [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)];

// --------------------------------------------------------------- IDENTIDADE
console.log("\n== quadrado em si mesmo é a identidade ==");
{
  const h = P.computeHomography(unitSquare, unitSquare);
  ok(h !== null, "resolve");
  const mid = P.applyHomography(h, pt(0.5, 0.5));
  ok(near(mid.x, 0.5) && near(mid.y, 0.5), "o meio fica no meio", mid);
  const corner = P.applyHomography(h, pt(1, 0));
  ok(near(corner.x, 1) && near(corner.y, 0), "um canto fica nele mesmo", corner);
}

// ------------------------------------------------------- CASO AFIM (RETO)
console.log("\n== quadrado -> retangulo, so escala e translada (sem perspectiva) ==");
{
  // (0,0)-(1,1) -> (10,20)-(30,50): escala (20,30), translada (10,20).
  // Um mapeamento retangulo-para-retangulo alinhado e SEMPRE afim: h6 e h7
  // tem que sair zero, e o meio tem que cair exatamente no meio — fato de
  // geometria afim que dá para conferir na mão, sem depender da fórmula.
  const rect = [pt(10, 20), pt(30, 20), pt(30, 50), pt(10, 50)];
  const h = P.computeHomography(unitSquare, rect);
  ok(h !== null, "resolve");
  ok(near(h[6], 0) && near(h[7], 0), "sem perspectiva sobrando num caso puramente afim", [h[6], h[7]]);

  const mid = P.applyHomography(h, pt(0.5, 0.5));
  ok(near(mid.x, 20) && near(mid.y, 35), "o meio do quadrado cai no meio do retangulo (20,35)", mid);

  const quarter = P.applyHomography(h, pt(0.25, 0.75));
  ok(near(quarter.x, 15) && near(quarter.y, 42.5), "e um ponto qualquer bate com escala+translacao na mao", quarter);
}

// -------------------------------------------------- CASO DE VERDADE (TORTO)
console.log("\n== quadrilatero em perspectiva de verdade (recupera coeficientes conhecidos) ==");
{
  // H conhecida de propósito, com h6/h7 diferentes de zero — a parte da
  // fórmula que só entra em jogo quando NÃO é um caso afim, e portanto a
  // única que um bug na eliminação de Gauss conseguiria esconder.
  const known = [1, 0.3, 0, 0.1, 1, 0, 0.2, 0.15, 1];
  const quad = unitSquare.map((p) => P.applyHomography(known, p));

  // Confirma que o quadrilátero gerado é mesmo torto e não uma coincidência
  // afim — senão o teste não estaria exercitando a perspectiva de verdade.
  const isRectangleish = near(quad[1].x - quad[0].x, quad[2].x - quad[3].x, 1e-3);
  ok(!isRectangleish, "o quadrilatero de teste realmente nao e um retangulo", quad);

  const recovered = P.computeHomography(unitSquare, quad);
  ok(recovered !== null, "resolve o caso torto");
  for (let i = 0; i < 9; i++) {
    ok(near(recovered[i], known[i], 1e-6), `coeficiente h[${i}] recuperado igual ao conhecido`,
      { esperado: known[i], obtido: recovered[i] });
  }
}

// ---------------------------------------------------------- GRAU DE LIBERDADE
console.log("\n== quadrilatero degenerado nao produz lixo silencioso ==");
{
  // Dois cantos DE ORIGEM iguais: pedir que o MESMO ponto (0,0) vire ao
  // mesmo tempo o canto sup-esq E o sup-dir do resultado não tem solução —
  // as duas linhas da matriz para esse ponto saem idênticas em u,v (ambas
  // zero), e isso é singularidade garantida, não questão de tolerância.
  const degenerate = [pt(0, 0), pt(0, 0), pt(1, 1), pt(0, 1)];
  const h = P.computeHomography(degenerate, unitSquare);
  ok(h === null, "devolve null em vez de uma matriz instavel");
}

// --------------------------------------------------- rectToQuadHomography
console.log("\n== a composicao retangulo -> foto que o recorte usa ==");
{
  const quad = [pt(5, 5), pt(105, 10), pt(100, 210), pt(0, 200)];
  const h = P.rectToQuadHomography(100, 200, quad);
  ok(h !== null, "resolve");
  const corners = [pt(0, 0), pt(100, 0), pt(100, 200), pt(0, 200)].map((p) => P.applyHomography(h, p));
  ok(near(corners[0].x, quad[0].x) && near(corners[0].y, quad[0].y), "canto sup-esq da saida cai no canto marcado na foto");
  ok(near(corners[2].x, quad[2].x) && near(corners[2].y, quad[2].y), "e o canto oposto tambem");
}

// ----------------------------------------------------------- suggestedOutputSize
console.log("\n== tamanho de saida sugerido ==");
{
  const rect = [pt(0, 0), pt(300, 0), pt(300, 400), pt(0, 400)];
  const small = P.suggestedOutputSize(rect, 2000);
  ok(small.width === 300 && small.height === 400, "sem teto, usa o tamanho real dos cantos", small);

  const big = P.suggestedOutputSize(rect, 200);
  ok(big.height === 200, "respeita o teto no lado mais longo", big);
  ok(Math.abs(big.width / big.height - 300 / 400) < 0.01, "mantem a proporcao ao reduzir", big);

  // Perspectiva real: o lado de cima mais curto que o de baixo (documento
  // fotografado de cima para baixo). A sugestão tem que usar o lado MAIOR,
  // senão o recorte perde conteúdo do lado mais generoso.
  const skewed = [pt(50, 0), pt(250, 0), pt(300, 400), pt(0, 400)];
  const s = P.suggestedOutputSize(skewed, 2000);
  ok(s.width === 300, "usa a largura do lado mais generoso, nao do mais curto", s);
}

// --------------------------------------------------------------- defaultQuad
console.log("\n== palpite inicial dos 4 cantos ==");
{
  const q = P.defaultQuad(1000, 2000, 0.1);
  ok(q[0].x === 100 && q[0].y === 200, "canto sup-esq com a margem certa", q[0]);
  ok(q[2].x === 900 && q[2].y === 1800, "canto inf-dir com a margem certa", q[2]);
  const q0 = P.defaultQuad(1000, 2000, 0);
  ok(q0[0].x === 0 && q0[2].x === 1000, "margem zero cobre o quadro inteiro", q0);
}

// -------------------------------------------------------- warpQuadToRect
console.log("\n== recorte pixel a pixel: identidade ==");
{
  // 2x2, cada pixel de uma cor. Homografia identidade: a saída tem que ser
  // byte a byte igual à entrada — se não for, o índice (y*w+x)*4+c está errado.
  const src = {
    width: 2, height: 2,
    data: new Uint8ClampedArray([
      255, 0, 0, 255, /**/ 0, 255, 0, 255,
      0, 0, 255, 255, /**/ 255, 255, 0, 255,
    ]),
  };
  const dst = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4) };
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  P.warpQuadToRect(src, dst, identity);
  ok(Array.from(dst.data).every((v, i) => v === src.data[i]), "identidade reproduz a origem pixel a pixel");
}

console.log("\n== recorte pixel a pixel: interpolacao bilinear no meio exato ==");
{
  // 2x2 com 4 cores puras nos 4 cantos. Amostrar exatamente o centro (0.5,0.5)
  // tem resposta certa calculável na mão: a média dos 4 cantos. É o teste que
  // pegaria a fórmula bilinear com o peso trocado (fx por fy, ou 1-fx no lugar
  // errado) — um erro desses não quebra nada, só sai com a cor errada.
  const src = {
    width: 2, height: 2,
    data: new Uint8ClampedArray([
      200, 0, 0, 255, /**/ 0, 200, 0, 255,
      0, 0, 200, 255, /**/ 200, 200, 0, 255,
    ]),
  };
  const dst = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
  // Translação pura, direto: o único pixel de saída (0,0) tem que amostrar a
  // origem em (0.5, 0.5) — o meio exato entre os 4 cantos do 2x2.
  const h = [1, 0, 0.5, 0, 1, 0.5, 0, 0, 1];
  P.warpQuadToRect(src, dst, h);
  const [r, g, b] = dst.data;
  // Cada canal tem cantos diferentes — a média certa é canal por canal, não
  // um número só reaproveitado para os três.
  const mediaR = (200 + 0 + 0 + 200) / 4;   // = 100
  const mediaG = (0 + 200 + 0 + 200) / 4;   // = 100
  const mediaB = (0 + 0 + 200 + 0) / 4;     // = 50
  ok(near(r, mediaR, 1) && near(g, mediaG, 1) && near(b, mediaB, 1),
    "o pixel do meio e a media dos 4 cantos, canal por canal", Array.from(dst.data));
}

console.log("\n== recorte pixel a pixel: fora da foto vira branco, nao preto ==");
{
  const src = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4).fill(0) };
  // Homografia que manda TUDO para fora da imagem de origem (translada +100).
  const h = [1, 0, 100, 0, 1, 100, 0, 0, 1];
  const dst = { width: 2, height: 2, data: new Uint8ClampedArray(2 * 2 * 4) };
  P.warpQuadToRect(src, dst, h);
  ok(Array.from(dst.data).every((v) => v === 255), "tudo fora da origem sai branco, nunca preto");
}

console.log(`\n=========== ${pass} passaram, ${fail} falharam ===========\n`);
process.exit(fail === 0 ? 0 : 1);
