import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { payslipsDoPeriodo } from "@/lib/hr/payslip";
import { pdfDosPayslips } from "@/lib/hr/payslipPdf";
import { nomeDoPayslip } from "@/lib/hr/payslipPuro";
import { tradutor } from "@/lib/i18nServer";
import { getServerSupabase } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { enviarPorEmail, configSmtp, enderecosDoRecibo } from "@/lib/invoicing/envio";

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

/**
 * ENVIAR O RECIBO por e-mail, à pessoa de quem ele é.
 *
 * ---------------------------------------------------------------------------
 * UMA PESSOA DE CADA VEZ, E NUNCA A EMPRESA INTEIRA
 *
 * O GET sem `employee` devolve o bloco todo num PDF só, e é o que se imprime.
 * Por e-mail isso seria mandar o salário de toda a gente para o endereço de uma
 * pessoa — a fuga de dados mais fácil de cometer sem se dar por ela, e a mais
 * difícil de desfazer. Aqui `employeeId` é obrigatório, e o destinatário é o
 * e-mail DAQUELA pessoa: nunca um endereço escrito no pedido.
 *
 * ---------------------------------------------------------------------------
 * SEM SERVIDOR DE CORREIO, RECUSA — E DIZ O QUE FALTA
 *
 * A alternativa era responder "enviado" e não enviar nada. Um recibo que a
 * pessoa não recebeu e o sistema diz que mandou é pior do que um botão que não
 * funciona: ninguém vai procurar a causa.
 *
 * ---------------------------------------------------------------------------
 * E NÃO SE MANDA DUAS VEZES SEM SE SABER
 *
 * `hr_payslip.emailed_at` guarda a data e o endereço usado (migração 062). Uma
 * segunda tentativa recusa e diz quando e para onde foi da primeira; repetir de
 * propósito é possível, mas tem de ser dito no pedido.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const acesso = await requireClient(params.id);
  if (denied(acesso)) return acesso.error;

  const corpo = await req.json().catch(() => ({}));
  const employeeId = String(corpo?.employeeId || "");
  if (!employeeId) {
    return NextResponse.json({ codigo: "recibo.semPessoa" }, { status: 400 });
  }
  const freq = String(corpo?.freq ?? "weekly");
  const freqType = (FREQ.includes(freq as any) ? freq : "weekly") as (typeof FREQ)[number];
  const year = Number(corpo?.year) || new Date().getFullYear();
  const periodNo = Number(corpo?.period) || 1;

  const sb = getServerSupabase();
  // O funcionário tem de ser DESTE cliente: sem isto o id do pedido bastava
  // para mandar o recibo de alguém de outra empresa.
  const { data: pessoa } = await sb.from("hr_employees")
    .select("id,first_name,surname,email")
    .eq("id", employeeId).eq("client_id", params.id).maybeSingle();
  if (!pessoa) return NextResponse.json({ codigo: "recibo.semPessoa" }, { status: 404 });

  const quem = [(pessoa as any).first_name, (pessoa as any).surname].filter(Boolean).join(" ");
  const para = String((pessoa as any).email || "").trim();
  if (!para) {
    return NextResponse.json(
      { codigo: "recibo.semEmail", params: { quem } }, { status: 409 }
    );
  }

  // A configuração confere-se ANTES de desenhar o PDF: gastar segundos a montar
  // um documento que não vai a lado nenhum é tempo que quem carregou está a ver.
  const cfg = configSmtp();
  if (!cfg.ok) {
    return NextResponse.json(
      { codigo: "recibo.semSmtp", params: { faltam: cfg.faltam.join(", ") } }, { status: 503 }
    );
  }

  const { data: gravado } = await sb.from("hr_payslip")
    .select("id,status,emailed_at,emailed_to")
    .eq("client_id", params.id).eq("employee_id", employeeId)
    .eq("year", year).eq("period_no", periodNo).eq("freq_type", freqType).maybeSingle();

  // Um rascunho não se manda: o próprio PDF traz o carimbo "não emitir", e o
  // número ainda muda. A pessoa que o recebesse ficava com dois recibos do
  // mesmo mês e nenhum a dizer qual vale.
  if (!gravado || (gravado as any).status !== "final") {
    return NextResponse.json({ codigo: "recibo.rascunho" }, { status: 409 });
  }
  if ((gravado as any).emailed_at && !corpo?.reenviar) {
    return NextResponse.json({
      codigo: "recibo.jaEnviado",
      params: {
        quando: String((gravado as any).emailed_at).slice(0, 10),
        para: (gravado as any).emailed_to || para,
      },
    }, { status: 409 });
  }

  const recibos = await payslipsDoPeriodo({
    clientId: params.id, year, periodNo, freqType, employeeId,
  });
  if (!recibos.length) return NextResponse.json({ codigo: "recibo.semPessoa" }, { status: 404 });

  const bytes = await pdfDosPayslips(recibos, tradutor());
  const empresa = recibos[0].empregador.nome;
  const rotulo = `${year} · ${freqType} ${periodNo}`;

  const r = await enviarPorEmail({
    para,
    assunto: String(corpo?.assunto ?? "").trim() || `Payslip ${rotulo} — ${empresa}`,
    corpo: String(corpo?.corpo ?? "").trim()
      || `Dear ${quem},\n\nPlease find attached your payslip for ${rotulo}.\n\n${empresa}`,
    // `pdfDosPayslips` devolve os bytes crus; o nodemailer quer um Buffer.
    anexo: { nome: nomeDoPayslip(quem, year, periodNo, freqType, false), bytes: Buffer.from(bytes) },
    ...enderecosDoRecibo(),
  });
  if (!r.ok) return NextResponse.json({ codigo: "recibo.recusado", params: { erro: r.erro ?? "" } }, { status: 502 });

  const user = await getSessionUser();
  await sb.from("hr_payslip").update({
    emailed_at: new Date().toISOString(), emailed_to: para, emailed_by: user?.id ?? null,
  }).eq("id", (gravado as any).id);

  return NextResponse.json({ ok: true, para });
}
