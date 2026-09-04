import { NextRequest, NextResponse } from "next/server";
import { requireClient, denied } from "@/lib/access";
import { requireRole, getSessionUser } from "@/lib/auth";
import { getServerSupabase } from "@/lib/supabase";
import { fecharFolha } from "@/lib/hr/folha";
import { garantirTitulosDaFolha, type RecadoDoTitulo, type TituloDaFolha } from "@/lib/financial/payrollTitles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/*
 * Cada empresa é uma folha inteira — recibos, imposto, acumulados e dois
 * títulos. Doze empresas de uma vez passam largamente do prazo por omissão.
 */
export const maxDuration = 300;

const FREQ = ["weekly", "fortnightly", "monthly"] as const;

/**
 * FECHAR A FOLHA DE VÁRIAS EMPRESAS DE UMA VEZ.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EM LOTE, SE JÁ DÁ PARA FECHAR UMA A UMA
 *
 * Pedido do Alfredo, e a razão é a forma do trabalho: "o teste será avulso, mas
 * a geração deverá ser em lote". O escritório não corre a folha de um cliente —
 * corre a folha da sexta-feira, que são as empresas todas do bloco semanal.
 * Abrir trinta e cinco separadores, escolher o período em cada um e carregar em
 * fechar trinta e cinco vezes é onde se esquece uma, e a que se esquece só
 * aparece um mês depois, quando alguém pergunta pelo recibo.
 *
 * ---------------------------------------------------------------------------
 * UMA EMPRESA QUE FALHA NÃO PÁRA O LOTE, E NADA FALHA EM SILÊNCIO
 *
 * A pior versão disto seria parar no primeiro erro: metade fechada, metade não,
 * e nenhuma lista de qual é qual. A segunda pior seria seguir em frente sem
 * dizer nada — e é essa que se descobre tarde.
 *
 * Por isso cada empresa devolve o que aconteceu, inclusive quando não aconteceu
 * nada: sem acesso, período já fechado, ninguém para pagar, integração
 * desligada. O relatório é a saída do lote, e não um efeito lateral dele.
 *
 * ---------------------------------------------------------------------------
 * A LISTA DE EMPRESAS VEM NO PEDIDO, E NÃO SE ADIVINHA
 *
 * Seria fácil correr "todas as empresas com bloco semanal ligado". Fechar a
 * folha é irreversível na prática — reabrir existe, mas os recibos já foram
 * vistos e o título já está na lista de contas a pagar — e um botão que faz
 * isso a um número de empresas que quem carrega não viu é um acidente à espera.
 * Quem manda o lote escolheu quem entra nele.
 */
export async function POST(req: NextRequest) {
  const guard = await requireRole("admin");
  if ("error" in guard) return guard.error;
  const user = await getSessionUser();

  const corpo = await req.json().catch(() => ({}));
  const freq = String(corpo?.freq ?? "weekly");
  const freqType = (FREQ.includes(freq as any) ? freq : "weekly") as (typeof FREQ)[number];
  const year = Number(corpo?.year) || new Date().getFullYear();
  const periodNo = Number(corpo?.period) || 1;
  const ids: string[] = Array.isArray(corpo?.clientIds)
    ? corpo.clientIds.map((x: any) => String(x || "")).filter(Boolean)
    : [];

  if (!ids.length) {
    return NextResponse.json({ error: "Escolha pelo menos uma empresa." }, { status: 400 });
  }
  // Um lote de duzentas empresas seria um pedido que morre a meio e deixa metade
  // fechada sem relatório nenhum. O limite é alto para não estorvar e baixo o
  // suficiente para o pedido caber no tempo.
  if (ids.length > 60) {
    return NextResponse.json({ error: "Lote demasiado grande: no maximo 60 empresas." }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { data: nomes } = await sb.from("clients").select("id,name,client_code").in("id", ids);
  const nomeDe = new Map<string, { name: string; code: string }>(
    ((nomes ?? []) as any[]).map((c) => [c.id, { name: c.name, code: c.client_code }])
  );

  type Resultado = {
    clientId: string; nome: string; codigo: string;
    gravados: number;
    titulos: TituloDaFolha[];
    /** Por que não se fez nada, quando não se fez. Chave de tradução. */
    recado?: RecadoDoTitulo;
  };
  const resultados: Resultado[] = [];

  for (const clientId of ids) {
    const quem = nomeDe.get(clientId);
    const base = {
      clientId, nome: quem?.name ?? clientId, codigo: quem?.code ?? "",
      gravados: 0, titulos: [] as TituloDaFolha[],
    };

    /*
     * O guarda por empresa corre DENTRO do laço, e a recusa não aborta o lote.
     *
     * Um id que a sessão não pode ver não é motivo para cancelar o trabalho das
     * outras trinta e quatro — mas também não desaparece da lista: aparece com
     * o motivo, senão quem manda o lote conta as linhas e falta uma.
     */
    const acesso = await requireClient(clientId);
    if (denied(acesso)) {
      resultados.push({ ...base, recado: { codigo: "lote.semAcesso" } });
      continue;
    }

    try {
      const r = await fecharFolha({
        clientId, year, periodNo, freqType,
        payDate: String(corpo?.payDate ?? "") || undefined,
        userId: user?.id ?? null,
      });
      if (!r.ok || !r.folha) {
        resultados.push({ ...base, recado: { codigo: "lote.naoFechou", params: { erro: r.erro ?? "" } } });
        continue;
      }

      const titulos = await garantirTitulosDaFolha({
        clientId, year, periodNo, freqType,
        payDate: r.folha.payDate, totais: r.folha.totais, pessoas: r.folha.linhas.length,
      });
      resultados.push({
        ...base, gravados: r.gravados ?? 0,
        titulos: titulos.titulos, recado: titulos.ignorado,
      });
    } catch (e: any) {
      /*
       * Uma excepção numa empresa não pode levar o lote atrás.
       *
       * O que rebenta aqui é rede e banco — um tempo esgotado a meio da folha de
       * uma empresa com quarenta pessoas. Sem este `catch`, o pedido inteiro
       * respondia 500 e quem o mandou ficava sem saber quais das empresas já
       * tinham fechado antes de ele morrer.
       */
      resultados.push({ ...base, recado: { codigo: "lote.erro", params: { erro: e?.message || String(e) } } });
    }
  }

  return NextResponse.json({ year, periodNo, freqType, resultados });
}
