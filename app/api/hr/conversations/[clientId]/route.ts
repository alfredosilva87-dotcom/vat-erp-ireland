import { NextRequest, NextResponse } from "next/server";
import { denied, requireClient } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { lerHorasDeTexto } from "@/lib/hr/lerHorasDeTexto";
import { enfileirarLeitura } from "@/lib/hr/filaDeHoras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A conversa de um cliente, do mais antigo para o mais recente. */
export async function GET(req: NextRequest, { params }: { params: { clientId: string } }) {
  const acesso = await requireClient(params.clientId);
  if (denied(acesso)) return acesso.error;

  const { data, error } = await getServerSupabase().from("hr_conversation")
    .select("*").eq("client_id", params.clientId)
    // Uma conversa lê-se de cima para baixo. O limite é explícito porque o
    // PostgREST corta em 1000 sem avisar, e um corte silencioso aqui daria a
    // ideia de que uma mensagem nunca existiu.
    .order("created_at", { ascending: false }).limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const mensagens = ((data ?? []) as any[]).reverse();
  return NextResponse.json({ mensagens });
}

/**
 * REGISTAR UMA MENSAGEM — e, se for do cliente e trouxer horas, lê-las.
 *
 * ---------------------------------------------------------------------------
 * DUAS PASSAGENS, E A PRIMEIRA NÃO ESCREVE NADA
 *
 * Sem `confirm`, lê-se e devolve-se o que se entendeu, sem gravar. Quem colou
 * vê as linhas ao lado do texto original, corrige, e só então confirma. Ler e
 * gravar no mesmo clique poria uma leitura automática a escrever sem ninguém
 * ver — e o que se lê aqui são frases escritas do telemóvel ao domingo à noite.
 *
 * ---------------------------------------------------------------------------
 * A MENSAGEM GRAVA-SE MESMO QUANDO NÃO SE LÊ NADA DELA
 *
 * "Mando-te amanhã" não tem horas nenhumas e é informação: é a diferença entre
 * um cliente que respondeu e um que desapareceu. Exigir horas para guardar a
 * mensagem faria a tela só registar metade da conversa — e seria a metade que
 * já estava resolvida.
 */
export async function POST(req: NextRequest, { params }: { params: { clientId: string } }) {
  const acesso = await requireClient(params.clientId);
  if (denied(acesso)) return acesso.error;

  const b = await req.json().catch(() => ({}));
  const body = String(b?.body ?? "").trim();
  const direction = b?.direction === "out" ? "out" : "in";
  const CANAIS = ["whatsapp", "email", "phone", "note"];
  const channel = CANAIS.includes(String(b?.channel)) ? String(b.channel) : "whatsapp";
  const ano = Number(b?.year) || new Date().getUTCFullYear();
  const confirmar = b?.confirm === true;
  // Ler horas de uma mensagem NOSSA não faz sentido: o que o escritório manda é
  // o pedido, não a resposta.
  const lerHoras = direction === "in" && b?.parseHours !== false;

  if (!body) return NextResponse.json({ error: "Mensagem vazia." }, { status: 400 });

  const leitura = lerHoras ? lerHorasDeTexto(body) : null;
  const semana = Number(b?.weekNo) || leitura?.semana || null;

  if (!confirmar) {
    return NextResponse.json({ ok: true, previa: true, leitura, semana });
  }

  const user = await getSessionUser();
  const sb = getServerSupabase();

  /*
   * A FILA PRIMEIRO, e a mensagem com o número que a fila devolveu.
   *
   * Ao contrário, a mensagem ficava gravada a dizer que enfileirou linhas que
   * afinal falharam — e o registo passava a mentir sobre o que aconteceu.
   */
  let queued = 0;
  let semCasar = 0;
  if (leitura?.linhas.length && semana) {
    const r = await enfileirarLeitura({
      clientId: params.clientId, leitura, ano, semana, origem: channel,
    });
    if (r.erro) return NextResponse.json({ error: r.erro }, { status: 500 });
    queued = r.criadas;
    semCasar = r.semCasar;
  }

  const { data, error } = await sb.from("hr_conversation").insert({
    client_id: params.clientId,
    direction, channel, body,
    year: semana ? ano : null,
    week_no: semana,
    parsed: leitura ? (leitura as any) : null,
    queued,
    created_by: user?.id ?? null,
  }).select().maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, mensagem: data, queued, semCasar, semana });
}

/**
 * Apagar uma mensagem.
 *
 * Só a mensagem: as linhas que ela pôs na fila ficam. Apagá-las em cascata
 * faria desaparecer horas que alguém já pode ter aprovado, e o registo do que
 * se pagou não pode depender de quem arruma a conversa.
 */
export async function DELETE(req: NextRequest, { params }: { params: { clientId: string } }) {
  const acesso = await requireClient(params.clientId);
  if (denied(acesso)) return acesso.error;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta a mensagem." }, { status: 400 });

  const { error } = await getServerSupabase().from("hr_conversation")
    .delete().eq("id", id).eq("client_id", params.clientId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
