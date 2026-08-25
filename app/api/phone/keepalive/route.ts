import { NextRequest, NextResponse } from "next/server";
import { getRelaySupabase, relayConfigured } from "@/lib/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mantém a passagem ACORDADA.
 *
 * ---------------------------------------------------------------------------
 * O PROBLEMA QUE ISTO RESOLVE, E QUE JÁ ACONTECEU
 *
 * O projeto Supabase da passagem está no plano gratuito, e esse plano **pausa
 * o projeto após 7 dias sem atividade**. Quando pausa, o banco para de
 * responder e o link `/enviar/<token>` que os clientes do escritório têm no
 * telemóvel deixa de funcionar. Em 2026-08-24 foi exatamente isso: o link
 * "estava indisponível" e não havia nada partido — o banco estava a dormir.
 *
 * O pior da falha é o silêncio: ninguém no escritório sabe que os clientes
 * deixaram de conseguir mandar foto. Só se descobre quando alguém reclama, e
 * até lá as notas do mês ficaram no telemóvel de quem as tirou.
 *
 * Uma consulta por dia basta: a contagem de 7 dias reinicia a cada pedido.
 * ---------------------------------------------------------------------------
 *
 * Corre na implantação da PASSAGEM, por cron da Vercel (ver `vercel.json`), e
 * não no servidor do escritório: o escritório pode estar desligado num fim de
 * semana longo, e é justamente aí que os 7 dias correm.
 *
 * É `GET` para o cron poder chamá-la, e devolve apenas contagens — nada do
 * conteúdo que está de passagem.
 */
export async function GET(req: NextRequest) {
  /*
   * Se `CRON_SECRET` estiver definido, exige-o. Se não estiver, deixa passar.
   *
   * O segredo é opcional de propósito: sem ele isto continua a funcionar numa
   * conta Vercel sem configuração nenhuma, e o que a rota expõe é uma contagem.
   * Exigir sempre transformaria uma variável esquecida num link de telefone
   * fora do ar — o problema que esta rota existe para evitar.
   */
  const segredo = process.env.CRON_SECRET;
  if (segredo && req.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  if (!relayConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Passagem nao configurada nesta implantacao." },
      { status: 503 }
    );
  }

  try {
    const sb = getRelaySupabase();
    /*
     * Uma consulta barata, mas REAL.
     *
     * `head: true` traz só a contagem, sem linha nenhuma — e continua a contar
     * como atividade no projeto, que é o objetivo. Contar `phone_links` e não
     * `phone_uploads` porque links existem sempre; uploads podem estar a zero
     * numa semana parada, e uma tabela vazia responde igual de qualquer forma.
     */
    const [links, pendentes] = await Promise.all([
      sb.from("phone_links").select("token", { count: "exact", head: true }).eq("active", true),
      sb.from("phone_uploads").select("id", { count: "exact", head: true }).is("fetched_at", null),
    ]);

    return NextResponse.json({
      ok: true,
      at: new Date().toISOString(),
      activeLinks: links.count ?? 0,
      // Fotos à espera de o escritório vir buscar. Um número que só cresce diz
      // que o servidor do escritório parou de buscar — outra falha silenciosa.
      pendingUploads: pendentes.count ?? 0,
    });
  } catch (e: any) {
    // 200 com `ok:false`, e não 500: o cron da Vercel marca o dia como falhado
    // e o histórico fica ilegível. Aqui o resultado é DADO, não falha de rota.
    return NextResponse.json({ ok: false, at: new Date().toISOString(), error: e?.message || "Falhou." });
  }
}
