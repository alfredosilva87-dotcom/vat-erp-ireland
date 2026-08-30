import "server-only";
import { Folha, A4, MARGEM, LARGURA } from "@/lib/accounting/pdfKit";
import type { InvoiceEmitida } from "./service";
import { calcularInvoice } from "./calculo";

/**
 * A invoice em PDF — o documento que sai da empresa.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE PDF TEM DE FAZER, E QUE UM RELATÓRIO INTERNO NÃO TEM
 *
 * Os outros PDFs do sistema são para dentro: o escritório imprime, confere,
 * arquiva. Este vai para o cliente do nosso cliente, muitas vezes é o único
 * contacto que essa pessoa tem com o negócio, e é ele que faz a empresa parecer
 * séria ou parecer um Word mal formatado.
 *
 * E tem exigências legais que um relatório não tem. Uma fatura irlandesa
 * precisa do nome e morada de quem emite, do número de VAT quando registado,
 * de número sequencial, data, e do IVA aberto por alíquota. Uma sociedade tem
 * ainda de mostrar o número no CRO e os diretores — daí o rodapé editável.
 * ---------------------------------------------------------------------------
 *
 * Desenhado a partir do modelo que o Alfredo mandou: logótipo e emitente em
 * cima à esquerda, INVOICE em grande à direita, a grelha de dados por baixo,
 * BILL TO / SHIP TO lado a lado, a tabela com faixa violeta, os totais
 * encostados à direita e os dados bancários no fim.
 */

const eur = (n: number) =>
  n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataIE = (iso: string | null) => {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

export type EmitenteDaInvoice = {
  nome: string;
  /** Morada e contactos, uma linha cada. */
  linhas: string[];
  vatNumber: string | null;
  /** PNG ou JPEG. Ausente é um caso normal: desenha-se o monograma. */
  logo?: { bytes: Buffer; mime: string } | null;
  /** "Brulor Limited is registered in Ireland (No. 593246). Directors: ..." */
  rodapeLegal?: string | null;
  banco?: { nome: string | null; iban: string | null; bic: string | null } | null;
};

/**
 * As iniciais, para quando não há logótipo.
 *
 * O quadrado com as iniciais é o que impede a fatura de parecer inacabada.
 * Deixar o canto vazio faz o documento parecer um rascunho — e é justamente o
 * caso mais comum, porque quase ninguém carrega o logótipo no primeiro dia.
 */
function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => /[A-Za-z]/.test(p));
  if (!partes.length) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

export async function pdfDaInvoice(
  inv: InvoiceEmitida, emitente: EmitenteDaInvoice
): Promise<Buffer> {
  const s = await Folha.criar();
  s.novaPagina();

  const totais = calcularInvoice(inv.items.map((i) => ({
    description: i.description, detail: i.detail,
    quantity: i.quantity, unitPrice: i.unitPrice, vatRate: i.vatRate,
  })));

  // ------------------------------------------------------------- cabeçalho
  let y = A4.h - MARGEM - 10;

  const LADO = 42;
  let xTexto = MARGEM;
  if (emitente.logo) {
    try {
      const img = emitente.logo.mime.includes("png")
        ? await s.pdf.embedPng(emitente.logo.bytes)
        : await s.pdf.embedJpg(emitente.logo.bytes);
      // Encaixa no quadrado sem esticar: um logótipo deformado é pior do que
      // nenhum, e as proporções que chegam aqui são imprevisíveis.
      const escala = Math.min(LADO / img.width, LADO / img.height);
      const l = img.width * escala, a = img.height * escala;
      s.pagina.drawImage(img, { x: MARGEM + (LADO - l) / 2, y: y - LADO + (LADO - a) / 2, width: l, height: a });
      xTexto = MARGEM + LADO + 14;
    } catch {
      // Um ficheiro que o pdf-lib não lê não pode impedir a fatura de sair.
      emitente.logo = null;
    }
  }
  if (!emitente.logo) {
    s.faixa(MARGEM, y - LADO, LADO, LADO, "accent");
    s.textoCentrado(iniciais(emitente.nome), MARGEM + LADO / 2, y - LADO / 2 - 6, {
      size: 17, bold: true, c: "surface",
    });
    xTexto = MARGEM + LADO + 14;
  }

  s.texto(emitente.nome, xTexto, y - 14, { size: 17, bold: true, c: "text", max: 34 });
  let yE = y - 30;
  for (const linha of emitente.linhas.slice(0, 6)) {
    s.texto(linha, xTexto, yE, { size: 8.5, c: "muted", max: 46 });
    yE -= 11;
  }
  if (emitente.vatNumber) {
    s.texto(`VAT  ${emitente.vatNumber}`, xTexto, yE, { size: 8.5, bold: true, c: "text", max: 40 });
    yE -= 11;
  }

  s.textoDireita("INVOICE", A4.w - MARGEM, y - 16, { size: 30, bold: true, c: "accent" });

  // ------------------------------------------- a grelha de dados, à direita
  const dados: [string, string][] = [
    ["Invoice No.", inv.status === "draft" ? "RASCUNHO" : inv.number],
    ["Invoice Date", dataIE(inv.issueDate)],
    ["Due Date", dataIE(inv.dueDate)],
  ];
  if (inv.customerRef) dados.push(["Customer Ref.", inv.customerRef]);
  if (inv.paymentTerms) dados.push(["Payment Terms", inv.paymentTerms]);

  let yG = y - 46;
  const xRotulo = A4.w - MARGEM - 190;
  for (const [rotulo, valor] of dados) {
    s.texto(rotulo, xRotulo, yG, { size: 8.5, bold: true, c: "text", max: 24 });
    s.textoDireita(valor, A4.w - MARGEM, yG, { size: 8.5, c: "text", max: 26 });
    yG -= 14;
  }

  s.y = Math.min(yE, yG) - 14;

  // -------------------------------------------------------- BILL TO / SHIP TO
  s.regua(s.y, "border");
  s.avanca(18);
  const yBloco = s.y;
  const meio = MARGEM + LARGURA / 2 + 8;

  const bloco = (titulo: string, nome: string, morada: string | null, vat: string | null, x: number) => {
    let yy = yBloco;
    s.texto(titulo, x, yy, { size: 8, bold: true, c: "accent", max: 16 });
    yy -= 14;
    s.texto(nome, x, yy, { size: 10, bold: true, c: "text", max: 34 });
    yy -= 13;
    for (const l of (morada ?? "").split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 5)) {
      s.texto(l, x, yy, { size: 8.5, c: "text", max: 38 });
      yy -= 11;
    }
    if (vat) {
      yy -= 3;
      s.texto(`VAT  ${vat}`, x, yy, { size: 8.5, bold: true, c: "text", max: 32 });
      yy -= 11;
    }
    return yy;
  };

  const yFim1 = bloco("BILL TO", inv.customerName, inv.customerAddr, inv.customerVat, MARGEM);
  // SHIP TO só aparece quando é DIFERENTE da morada de faturação. Repetir a
  // mesma morada nas duas colunas é ruído que faz duvidar de qual é qual.
  const yFim2 = inv.customerShip?.trim()
    ? bloco("SHIP TO", inv.customerName, inv.customerShip, null, meio)
    : yBloco;

  s.y = Math.min(yFim1, yFim2) - 16;

  // ------------------------------------------------------------- a tabela
  const COLS = { desc: MARGEM + 6, qtd: MARGEM + 250, preco: MARGEM + 320, taxa: MARGEM + 380, iva: MARGEM + 440, total: A4.w - MARGEM - 6 };
  const ALTURA_CAB = 22;

  const cabecalhoDaTabela = () => {
    s.faixa(MARGEM, s.y - ALTURA_CAB, LARGURA, ALTURA_CAB, "primary");
    const yc = s.y - ALTURA_CAB + 7;
    s.texto("DESCRIPTION", COLS.desc, yc, { size: 7.5, bold: true, c: "surface", max: 20 });
    s.textoDireita("QTY", COLS.qtd, yc, { size: 7.5, bold: true, c: "surface" });
    s.textoDireita("UNIT PRICE", COLS.preco, yc, { size: 7.5, bold: true, c: "surface" });
    s.textoDireita("VAT %", COLS.taxa, yc, { size: 7.5, bold: true, c: "surface" });
    s.textoDireita("VAT AMOUNT", COLS.iva, yc, { size: 7.5, bold: true, c: "surface" });
    s.textoDireita("AMOUNT", COLS.total, yc, { size: 7.5, bold: true, c: "surface" });
    s.avanca(ALTURA_CAB);
  };

  s.espaco(ALTURA_CAB + 40);
  cabecalhoDaTabela();

  for (const l of totais.linhas) {
    const temDetalhe = Boolean(l.detail?.trim());
    const alturaLinha = temDetalhe ? 30 : 22;

    // A tabela pode passar de uma página, e é aqui que a maior parte dos
    // geradores de fatura desenha por baixo do rodapé sem avisar.
    if (s.y - alturaLinha < MARGEM + 150) {
      s.novaPagina();
      s.y = A4.h - MARGEM - 10;
      cabecalhoDaTabela();
    }

    const yl = s.y - (temDetalhe ? 13 : 15);
    s.texto(l.description, COLS.desc, yl, { size: 9, bold: true, c: "text", max: 46 });
    if (temDetalhe) s.texto(l.detail!, COLS.desc, yl - 11, { size: 7.5, c: "muted", max: 60 });

    const yv = s.y - (temDetalhe ? 17 : 15);
    s.textoDireita(l.quantity.toFixed(2), COLS.qtd, yv, { size: 9, c: "text" });
    s.textoDireita(eur(l.unitPrice), COLS.preco, yv, { size: 9, c: "text" });
    s.textoDireita(`${l.vatRate}%`, COLS.taxa, yv, { size: 9, c: "text" });
    s.textoDireita(eur(l.vat), COLS.iva, yv, { size: 9, c: "text" });
    s.textoDireita(eur(l.net + l.vat), COLS.total, yv, { size: 9, bold: true, c: "text" });

    s.avanca(alturaLinha);
    s.regua(s.y, "border", 0.5);
  }

  // -------------------------------------------------------------- os totais
  s.avanca(14);
  const xRotuloT = A4.w - MARGEM - 200;

  const totalLinha = (rotulo: string, valor: string, destaque = false) => {
    s.texto(rotulo, xRotuloT, s.y, { size: destaque ? 10 : 9, bold: destaque, c: destaque ? "text" : "muted", max: 26 });
    s.textoDireita(valor, A4.w - MARGEM - 6, s.y, { size: destaque ? 10 : 9, bold: true, c: "text" });
    s.avanca(16);
  };

  totalLinha("SUBTOTAL", `EUR ${eur(totais.net)}`);
  // Uma linha POR ALÍQUOTA. Um "VAT" agregado numa fatura com 23% e 13,5% não
  // deixa o comprador conferir, e é o que a Revenue quer ver aberto.
  for (const g of totais.porTaxa) {
    if (g.vat === 0 && g.rate === 0) continue;
    totalLinha(`VAT ${g.rate}%`, `EUR ${eur(g.vat)}`);
  }

  s.avanca(4);
  const ALT = 34;
  s.faixa(xRotuloT - 12, s.y - ALT + 10, A4.w - MARGEM - xRotuloT + 12, ALT, "accentSoft");
  s.texto("TOTAL DUE", xRotuloT, s.y - 6, { size: 10, bold: true, c: "text", max: 16 });
  s.textoDireita(`EUR ${eur(totais.gross)}`, A4.w - MARGEM - 6, s.y - 8, { size: 15, bold: true, c: "accent" });
  s.avanca(ALT + 16);

  // -------------------------------------------- banco, nota e rodapé legal
  if (s.y < MARGEM + 110) { s.novaPagina(); s.y = A4.h - MARGEM - 20; }

  s.regua(s.y, "border");
  s.avanca(18);
  const yRodape = s.y;

  if (emitente.banco?.iban) {
    s.texto("BANK DETAILS", MARGEM, yRodape, { size: 8, bold: true, c: "accent", max: 16 });
    let yb = yRodape - 14;
    if (emitente.banco.nome) { s.texto(emitente.banco.nome, MARGEM, yb, { size: 8.5, c: "text", max: 40 }); yb -= 11; }
    s.texto("IBAN", MARGEM, yb, { size: 8, bold: true, c: "accent", max: 6 });
    s.texto(emitente.banco.iban, MARGEM + 34, yb, { size: 8.5, c: "text", max: 34 });
    yb -= 11;
    if (emitente.banco.bic) {
      s.texto("BIC", MARGEM, yb, { size: 8, bold: true, c: "accent", max: 6 });
      s.texto(emitente.banco.bic, MARGEM + 34, yb, { size: 8.5, c: "text", max: 20 });
    }
  }

  const xNota = MARGEM + LARGURA / 2 + 8;
  s.texto("Thank you for your business.", xNota, yRodape, { size: 8.5, bold: true, c: "accent", max: 34 });
  if (inv.notes?.trim()) {
    s.paragrafo(inv.notes.trim(), xNota, yRodape - 14, LARGURA / 2 - 8, { size: 8, c: "text" });
  }

  if (emitente.rodapeLegal?.trim()) {
    // O rodapé legal fica no FUNDO da página, e não a seguir ao conteúdo: é
    // onde quem procura o número no CRO vai olhar, seja qual for o tamanho da
    // fatura.
    s.regua(MARGEM + 16, "border", 0.6);
    s.textoCentrado(emitente.rodapeLegal.trim(), A4.w / 2, MARGEM + 4, { size: 7.5, c: "muted", max: 130 });
  }

  return Buffer.from(await s.pdf.save());
}
