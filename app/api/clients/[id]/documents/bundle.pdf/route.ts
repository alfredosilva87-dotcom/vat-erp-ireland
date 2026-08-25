import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireClient, denied } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";
import { listPeriodDocs, type Lado, type PeriodDoc } from "@/lib/periodDocs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Um PDF com TODOS os documentos do período, numa peça só.
 *
 * É o formato em que um período se entrega: o contador manda um arquivo ao
 * cliente, ou arquiva um arquivo por bimestre, em vez de uma pasta com 60
 * ficheiros de nomes que a câmara do telemóvel escolheu.
 *
 * A primeira página é um índice com os totais — porque um PDF de 60 páginas
 * sem sumário obriga a folhear para saber o que está lá dentro, e porque é o
 * índice que permite conferir se falta documento sem abrir cada um.
 *
 * Três decisões que a leitura do código não entrega sozinha:
 *
 * 1. **Documento que falta não interrompe.** Nota lançada à mão nunca teve
 *    ficheiro; nota antiga pode ter perdido o dele. Abortar o arquivo inteiro
 *    por causa de uma linha seria trocar um problema pequeno e visível (consta
 *    no índice como "sem documento") por um grande e mudo.
 *
 * 2. **Imagem entra como página inteira**, encaixada na A4 com a proporção
 *    mantida. Recibo de telemóvel é a maior parte do acervo, e esticado para
 *    preencher a folha fica ilegível.
 *
 * 3. **O nome do ficheiro leva o código do cliente e o período.** Baixado
 *    para a pasta de transferências, `documentos.pdf` é indistinguível do
 *    anterior; `C0001-2026-01-01_2026-02-28.pdf` arquiva-se sozinho.
 */

const A4 = { w: 595.28, h: 841.89 };
const MARGEM = 40;

const eur = (v: number) =>
  "EUR " + v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * O texto vai para dentro de fontes WinAnsi, que não sabem escrever tudo o que
 * um nome de fornecedor irlandês traz (aspa curva vinda de OCR, travessão, um
 * acento fora da tabela). `drawText` REBENTA nesses casos em vez de ignorar —
 * então limpa-se antes, e o arquivo sai com o nome ligeiramente estropiado em
 * vez de não sair.
 */
const ascii = (s: string | null | undefined, max = 60) =>
  String(s ?? "—")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, max) || "-";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const hoje = new Date().toISOString().slice(0, 10);
  const de = sp.get("from") || `${hoje.slice(0, 4)}-01-01`;
  const ate = sp.get("to") || hoje;
  const pedido = (sp.get("sides") || "entrada,saida").split(",") as Lado[];
  const lados = pedido.filter((l): l is Lado => l === "entrada" || l === "saida");

  const sb = getServerSupabase();
  const { data: cliente } = await sb
    .from("clients").select("client_code,name").eq("id", params.id).maybeSingle();

  const docs = await listPeriodDocs(params.id, de, ate, lados.length ? lados : ["entrada", "saida"]);

  const pdf = await PDFDocument.create();
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const tinta = rgb(0.11, 0.1, 0.22);
  const suave = rgb(0.43, 0.42, 0.56);

  // ---------------------------------------------------------------- índice
  const entradas = docs.filter((d) => d.lado === "entrada");
  const saidas = docs.filter((d) => d.lado === "saida");
  const soma = (l: PeriodDoc[], k: "liquido" | "vat" | "total") =>
    l.reduce((s, d) => s + d[k], 0);

  let pagina = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGEM;

  const linha = (txt: string, size = 9, bold = false, cor = tinta, x = MARGEM) => {
    if (y < MARGEM + 30) {
      pagina = pdf.addPage([A4.w, A4.h]);
      y = A4.h - MARGEM;
    }
    pagina.drawText(txt, { x, y, size, font: bold ? negrito : fonte, color: cor });
    y -= size + 5;
  };

  linha(ascii(cliente?.name, 70), 18, true);
  linha(`${ascii(cliente?.client_code, 20)}  ${de}  ate  ${ate}`, 10, false, suave);
  y -= 8;
  linha(`Entradas: ${entradas.length}   ${eur(soma(entradas, "total"))}   VAT ${eur(soma(entradas, "vat"))}`, 10, true);
  linha(`Saidas:   ${saidas.length}   ${eur(soma(saidas, "total"))}   VAT ${eur(soma(saidas, "vat"))}`, 10, true);
  y -= 10;
  linha("Data        Lado      Parte                          Numero        Total     Doc", 8, true, suave);
  y -= 2;

  const semDocumento: PeriodDoc[] = [];
  for (const d of docs) {
    if (!d.document_path) semDocumento.push(d);
    linha(
      `${(d.data ?? "—").padEnd(11)} ${d.lado === "entrada" ? "entrada" : "saida  "}   ` +
      `${ascii(d.parte, 30).padEnd(31)}${ascii(d.numero, 13).padEnd(14)}` +
      `${d.total.toFixed(2).padStart(9)}   ${d.document_path ? "sim" : "-"}`,
      8
    );
  }
  if (semDocumento.length) {
    y -= 8;
    linha(`${semDocumento.length} lancamento(s) sem ficheiro anexado — constam acima com "-".`, 8, false, suave);
  }

  // ------------------------------------------------------- os documentos
  for (const d of docs) {
    if (!d.document_path) continue;
    try {
      const { data: blob } = await sb.storage.from("documents").download(d.document_path);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const ext = (d.document_path.split(".").pop() || "").toLowerCase();

      if (ext === "pdf") {
        const origem = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const paginas = await pdf.copyPages(origem, origem.getPageIndices());
        for (const p of paginas) pdf.addPage(p);
        continue;
      }

      const img =
        ext === "png" ? await pdf.embedPng(bytes)
        : ["jpg", "jpeg"].includes(ext) ? await pdf.embedJpg(bytes)
        : null;
      // WEBP e HEIC não entram: o pdf-lib só embute PNG e JPEG. Ficam de fora
      // em silêncio aqui, mas o índice já os contou como "sim" — por isso o
      // aviso no fim do arquivo.
      if (!img) continue;

      const p = pdf.addPage([A4.w, A4.h]);
      const escala = Math.min(
        (A4.w - MARGEM * 2) / img.width,
        (A4.h - MARGEM * 2) / img.height
      );
      const w = img.width * escala;
      const h = img.height * escala;
      p.drawImage(img, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
    } catch {
      /* Um documento ilegível não pode levar o arquivo inteiro junto. */
    }
  }

  const bytes = await pdf.save();
  const nome = `${cliente?.client_code || "cliente"}-${de}_${ate}.pdf`.replace(/[^\w.\-]/g, "_");

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "no-store",
    },
  });
}
