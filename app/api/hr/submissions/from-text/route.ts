import { NextRequest, NextResponse } from "next/server";
import { denied, requireClient } from "@/lib/access";
import { getServerSupabase } from "@/lib/supabase";
import { lerHorasDeTexto } from "@/lib/hr/lerHorasDeTexto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A MENSAGEM DE WHATSAPP, LIDA E POSTA NA FILA.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ISTO ACEITA TEXTO COLADO, E NÃO SÓ UM WEBHOOK
 *
 * Ler o WhatsApp de alguém automaticamente não é possível por via oficial: a
 * Cloud API só entrega mensagens enviadas para um número registado na
 * plataforma Business. As horas hoje chegam ao telemóvel PESSOAL do Matheus, e
 * nenhum número pessoal é legível dessa maneira.
 *
 * Então esta rota aceita o texto colado. Isso serve HOJE, sem depender de nada
 * — e no dia em que houver um número Business, o webhook chama exactamente esta
 * mesma leitura. O caminho não muda; só muda quem o alimenta.
 *
 * ---------------------------------------------------------------------------
 * DUAS PASSAGENS, E A PRIMEIRA NÃO ESCREVE NADA
 *
 * `preview` lê e devolve o que entendeu, sem tocar em nada. Quem colou vê as
 * linhas ao lado do texto original, corrige o que estiver mal, e só então
 * confirma. Ler e gravar no mesmo clique poria uma leitura automática a
 * escrever sem ninguém ver — e o que se lê aqui são mensagens escritas à mão,
 * ao domingo à noite.
 *
 * E mesmo depois de confirmar, isto NÃO toca nas horas oficiais: vai para
 * `hr_hour_submissions`, a fila que já existe e que já exige aprovação.
 */

export async function POST(req: NextRequest) {
  const corpo = await req.json().catch(() => ({}));
  const clientId = String(corpo?.clientId ?? "").trim();
  const texto = String(corpo?.text ?? "");
  const ano = Number(corpo?.year) || new Date().getUTCFullYear();
  const semanaEscolhida = Number(corpo?.weekNo) || null;
  const confirmar = corpo?.confirm === true;

  if (!clientId) return NextResponse.json({ error: "Falta o cliente." }, { status: 400 });
  const acesso = await requireClient(clientId);
  if (denied(acesso)) return acesso.error;

  const leitura = lerHorasDeTexto(texto);
  const semana = semanaEscolhida ?? leitura.semana;

  if (!confirmar) {
    // Primeira passagem: mostrar, não gravar.
    return NextResponse.json({ ok: true, previa: true, ...leitura, semana });
  }

  /*
   * A SEMANA TEM DE SER CERTA, E NÃO SE ADIVINHA.
   *
   * Sem semana, estas horas iriam para um período qualquer — e horas lançadas
   * na semana errada saem num recibo errado e só se descobrem quando alguém
   * reclama o salário. Recusar aqui é a única coisa honesta a fazer.
   */
  if (!semana || semana < 1 || semana > 53) {
    return NextResponse.json({ error: "semSemana", chave: "wa.semSemana" }, { status: 400 });
  }
  if (!leitura.linhas.length) {
    return NextResponse.json({ error: "nadaLido", chave: "wa.nadaLido" }, { status: 400 });
  }

  const sb = getServerSupabase();

  /*
   * O casamento com o funcionário é por NOME, e é deliberadamente frouxo aqui:
   * quem escreve manda "João" e o cadastro diz "João Manuel Silva". Compara-se
   * sem acentos e sem maiúsculas, e um nome que não casa vai na mesma para a
   * fila — com `employee_id` nulo e o nome como veio.
   *
   * Isto está certo: quem aprova a fila vê o nome e escolhe a pessoa. Adivinhar
   * o funcionário errado seria pior do que não adivinhar nenhum.
   */
  const { data: emps } = await sb.from("hr_employees")
    .select("id,first_name,surname").eq("client_id", clientId).eq("active", true);

  const simples = (s: string) =>
    String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  const acharEmpregado = (nome: string) => {
    const n = simples(nome);
    if (!n) return null;
    const lista = (emps ?? []) as any[];
    const inteiro = lista.find((e) => simples(`${e.first_name} ${e.surname}`) === n);
    if (inteiro) return inteiro;
    // "João" contra "João Manuel Silva": o primeiro nome basta quando é único.
    const porPrimeiro = lista.filter((e) => simples(e.first_name) === n);
    return porPrimeiro.length === 1 ? porPrimeiro[0] : null;
  };

  const linhas = leitura.linhas.map((l) => {
    const emp = acharEmpregado(l.nome);
    return {
      client_id: clientId,
      employee_id: emp?.id ?? null,
      employee_name: emp ? `${emp.first_name} ${emp.surname}`.trim() : l.nome,
      year: ano,
      week_no: semana,
      hours: l.horas,
      sunday_hours: l.horasDomingo,
      holiday_hours: l.horasFeriado,
      week_worked: l.trabalhou,
      // A linha ORIGINAL viaja com o pedido. Quem aprova compara com o que a
      // pessoa escreveu, em vez de confiar na nossa leitura.
      note: l.origem,
      submitted_by: "whatsapp",
    };
  });

  const { error } = await sb.from("hr_hour_submissions").insert(linhas);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    criadas: linhas.length,
    semCasar: linhas.filter((l) => !l.employee_id).length,
    naoLidas: leitura.naoLidas,
    semana,
  });
}
