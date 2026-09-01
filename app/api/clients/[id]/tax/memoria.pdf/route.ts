import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";
import { conciliacaoFiscal } from "@/lib/fiscal/conciliacaoDados";
import { timbreDoCliente } from "@/lib/accounting/comparative";
import { memoriaDeCT, type LinhaDaMemoria } from "@/lib/fiscal/memoriaDeCalculo";
import {
  A4, MARGEM, LARGURA, Folha, timbre, rodape, tituloDoRelatorio, faixaDeSecao,
} from "@/lib/accounting/pdfKit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A MEMÓRIA DE CÁLCULO EM PAPEL — a que vai para a mão do cliente.
 *
 * ---------------------------------------------------------------------------
 * SAI DA MESMA CONTA QUE ESTÁ NA TELA
 *
 * `memoriaDeCT` é chamada aqui outra vez, com os mesmos números que a tela lhe
 * passou pelo endereço. Não há uma segunda fórmula: o papel que o cliente
 * recebe não pode discordar do que o escritório está a ver, e a única forma de
 * garantir isso é não haver duas contas.
 *
 * O LUCRO, esse, é lido do razão aqui e não recebido da tela — é o único número
 * que não pode vir do navegador. Os três ajustes vêm, porque são escolha de
 * quem faz a conta e não existem em lado nenhum para serem lidos.
 * ---------------------------------------------------------------------------
 */

const eur = (n: number) =>
  (n < 0 ? "-" : "") + "EUR " + Math.abs(n).toLocaleString("en-IE", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

/** Os rótulos do papel. Em inglês: é o documento de um escritório irlandês. */
const ROTULO: Record<LinhaDaMemoria["chave"], string> = {
  lucroContabil: "Profit before tax, per the accounts",
  naoDedutivel: "Add: expenses not deductible",
  naoTributavel: "Less: income not taxable",
  lucroTributavel: "Taxable profit",
  baseExploracao: "Trading profit",
  basePassivo: "Passive income (rent, interest)",
  impostoDoExercicio: "Tax for the year",
  jaReconhecido: "Less: already posted in the accounts",
  porReconhecer: "Still to post",
};

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const sp = new URL(req.url).searchParams;
  const data = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const ano = new Date().getUTCFullYear();
  const de = data(sp.get("de")) ?? `${ano}-01-01`;
  const ate = data(sp.get("ate")) ?? `${ano}-12-31`;
  const numero = (k: string) => Math.abs(Number(sp.get(k)) || 0);

  try {
    const sb = getServerSupabase();
    const [fiscal, escritorio, { data: cliente }] = await Promise.all([
      conciliacaoFiscal(params.id, de, ate),
      timbreDoCliente(params.id),
      sb.from("clients").select("name,client_code,cro,vat_number").eq("id", params.id).maybeSingle(),
    ]);

    const m = memoriaDeCT({
      lucroAntesDeImposto: fiscal.imposto.lucroAntesDeImposto,
      naoDedutivel: numero("nd"),
      naoTributavel: numero("nt"),
      rendimentoPassivo: numero("rp"),
      jaReconhecido: fiscal.imposto.despesaDeImposto,
    });

    const c = (cliente as any) ?? {};
    const s = await Folha.criar();
    s.aoAbrirPagina((folha) => timbre(folha, {
      firma: escritorio?.name || "",
      linhas: [
        escritorio?.address || "",
        [escritorio?.phone, escritorio?.website].filter(Boolean).join("  -  "),
        escritorio?.contact_email || "",
      ].filter(Boolean),
      cliente: c.name || "",
      identificacao: [
        c.cro ? `CRO ${c.cro}` : "",
        c.vat_number ? `VAT ${c.vat_number}` : "",
        c.client_code || "",
      ].filter(Boolean),
    }));
    s.novaPagina();

    tituloDoRelatorio(s, "Corporation tax computation", `Period ${de} to ${ate}`, "EUR");
    faixaDeSecao(s, "How the tax is worked out");

    for (const l of m.linhas) {
      const forte = l.tipo === "subtotal" || l.tipo === "total";
      if (forte) s.faixa(MARGEM, s.y - 4, LARGURA, 15, "rowAlt");

      const rotulo = ROTULO[l.chave];
      const recuo = l.tipo === "ajuste" ? 14 : 0;
      s.texto(rotulo, MARGEM + 4 + recuo, s.y, {
        size: forte ? 9 : 8.5, bold: forte, c: l.tipo === "ajuste" ? "muted" : "text", max: 60,
      });

      // A base e a alíquota ao lado do rótulo — só duas linhas as têm, e uma
      // coluna quase vazia lê-se pior do que um parêntese.
      if (l.tipo === "taxa") {
        s.texto(`${eur(l.base ?? 0)} at ${l.taxa}%`, MARGEM + 4 + 210, s.y,
          { size: 7.5, c: "muted", max: 40 });
      }

      s.textoDireita(eur(l.valor), A4.w - MARGEM - 4, s.y,
        { size: forte ? 9 : 8.5, bold: forte, c: l.tipo === "total" ? "primary" : "text" });
      s.avanca(forte ? 17 : 14);
    }

    s.avanca(8);
    /*
     * A NOTA NÃO É DECORAÇÃO.
     *
     * Este papel sai do escritório com um número em cima. Quem o receber tem de
     * saber que os dois ajustes foram escritos por uma pessoa e não lidos da
     * contabilidade — senão lê-o como se o sistema os tivesse apurado.
     */
    const nota = m.prejuizo
      ? "The period is a loss, so no tax arises. Losses carry forward - a separate computation."
      : "Adjustments for non-deductible expenses, non-taxable income and passive income are entered "
        + "by the practice; the accounts do not record them. Rates: 12.5% trading, 25% passive income.";
    s.texto(nota, MARGEM, s.y, { size: 7.5, c: "muted", max: 118 });
    s.avanca(11);
    if (!m.prejuizo && m.taxaEfetiva !== null) {
      s.texto(`Effective rate on the accounting profit: ${m.taxaEfetiva}%`, MARGEM, s.y,
        { size: 8, c: "text", max: 80 });
    }

    rodape(s, "Corporation tax computation - prepared from the client's ledger.", 1);
    const bytes = await s.bytes();

    const nome = `CT-computation-${(c.client_code || c.name || "client")
      .replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 40)}-${de}.pdf`;

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nome}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Falhou." }, { status: 500 });
  }
}
