import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { payslipsDoPeriodo } from "@/lib/hr/payslip";
import { pdfDosPayslips } from "@/lib/hr/payslipPdf";
import { nomeDoPayslip } from "@/lib/hr/payslipPuro";
import { tradutor } from "@/lib/i18nServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Lê o quadro, os recibos gravados e o livro de horas, e desenha o PDF.
export const maxDuration = 60;

const FREQ = ["weekly", "fortnightly", "monthly"] as const;

/**
 * OS RECIBOS de um período, em PDF.
 *
 * Sem `employee` sai a empresa inteira — um recibo por página, na mesma ordem
 * do ecrã. É esse o pedido normal: quem corre a folha imprime tudo de uma vez.
 *
 * Fica no GET e não no POST de propósito: um recibo é uma LEITURA, e um link
 * que se abre num separador novo é o que faz isto funcionar no telemóvel sem
 * mais nada à volta.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const q = req.nextUrl.searchParams;
  const freq = String(q.get("freq") ?? "weekly");
  const year = Number(q.get("year")) || new Date().getFullYear();
  const periodNo = Number(q.get("period")) || 1;
  const employeeId = q.get("employee") || null;

  const recibos = await payslipsDoPeriodo({
    clientId: params.id, year, periodNo,
    freqType: (FREQ.includes(freq as any) ? freq : "weekly") as (typeof FREQ)[number],
    employeeId,
  });
  if (!recibos.length) {
    return NextResponse.json({ error: "Ninguem para este periodo." }, { status: 404 });
  }

  /*
   * O recibo sai no idioma de quem o pediu — ver `lib/i18nServer.ts`.
   *
   * O escritório emite recibos para gente que fala português e espanhol, e é
   * este o documento com que essa pessoa confere o próprio salário.
   */
  const bytes = await pdfDosPayslips(recibos, tradutor());

  const um = recibos.length === 1 ? recibos[0] : null;
  const nome = um
    ? nomeDoPayslip(um.pessoa.nome, year, periodNo, um.periodo.freq, um.rascunho)
    : `payslips-${year}-${String(periodNo).padStart(2, "0")}.pdf`;

  return new NextResponse(bytes as any, {
    headers: {
      "Content-Type": "application/pdf",
      // Inline: quem gera um recibo quer VÊ-LO antes de o entregar.
      "Content-Disposition":
        `${q.get("download") === "1" ? "attachment" : "inline"}; filename="${nome}"`,
      "X-Content-Type-Options": "nosniff",
      // Um recibo é dado pessoal: não fica em cache nenhuma pelo caminho.
      "Cache-Control": "private, no-store",
    },
  });
}
