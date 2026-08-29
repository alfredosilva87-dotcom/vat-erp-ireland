import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { avisoDeLimiarVat, type AvisoDeLimiar } from "./formaJuridica";

/**
 * O faturamento dos últimos 12 meses, para o limiar de registo de VAT.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É O ÚNICO ALERTA COM PREÇO
 *
 * O resto do calendário são prazos: falhar custa uma coima, e a coima tem
 * tabela. Este não. Quem passa o limiar e não se regista **deve à Revenue o IVA
 * das vendas que fez sem o cobrar** — o cliente já entregou o serviço, já
 * recebeu o preço sem IVA, e o imposto sai do bolso dele.
 *
 * Num cliente a faturar €45.000 em serviços, são uns €10.000 que ninguém
 * cobrou a ninguém. E nada no sistema alertava: o faturamento existia, os
 * limiares existiam, e ninguém os punha lado a lado.
 * ---------------------------------------------------------------------------
 *
 * A regra irlandesa é de 12 MESES A ROLAR — e não de ano civil. Um cliente pode
 * estar abaixo em cada ano fechado e ter passado o limiar a meio, entre julho e
 * junho seguinte. É por isso que a janela anda com o dia de hoje.
 */

const PAGINA = 1000;

export type LeituraDeLimiar = {
  /** `yyyy-mm-dd`, o primeiro dia da janela olhada. */
  desde: string;
  ate: string;
  faturamento: number;
  documentos: number;
  registadoParaVat: boolean;
  aviso: AvisoDeLimiar | null;
};

/** O mesmo dia, doze meses antes. `2026-08-29` → `2025-08-29`. */
function umAnoAntes(iso: string): string {
  const ano = +iso.slice(0, 4) - 1;
  return `${ano}${iso.slice(4)}`;
}

export async function leituraDeLimiar(
  clientId: string,
  hoje = new Date().toISOString().slice(0, 10)
): Promise<LeituraDeLimiar> {
  const sb = getServerSupabase();
  const desde = umAnoAntes(hoje);

  const { data: cliente } = await sb.from("clients")
    .select("vat_number").eq("id", clientId).maybeSingle();
  /*
   * Ter número de VAT é a prova de que o cliente JÁ está registado, e um
   * cliente registado não tem limiar nenhum para passar — o aviso desliga-se
   * sozinho. É a leitura mais fiável que existe sem perguntar à Revenue.
   */
  const registado = Boolean((cliente as any)?.vat_number?.trim());

  const vendas: { id: string; net: number }[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data } = await sb.from("sales")
      .select("id,net_amount")
      .eq("client_id", clientId)
      .gte("entry_date", desde).lte("entry_date", hoje)
      .range(inicio, inicio + PAGINA - 1);
    const lote = (data ?? []) as any[];
    vendas.push(...lote.map((s) => ({ id: s.id, net: Number(s.net_amount || 0) })));
    if (lote.length < PAGINA) break;
  }

  /*
   * O cabeçalho da venda nem sempre traz o líquido.
   *
   * As vendas lidas de documento gravam o valor nas LINHAS e deixam o
   * cabeçalho a zero — é a mesma assimetria que já mordeu a contabilização.
   * Somar só o cabeçalho aqui daria um faturamento abaixo do real, e um
   * faturamento abaixo do real neste sítio significa não avisar quem devia ser
   * avisado. O erro tem de cair para o lado seguro.
   */
  const semCabecalho = vendas.filter((v) => !v.net).map((v) => v.id);
  const porLinhas = new Map<string, number>();
  for (let i = 0; i < semCabecalho.length; i += PAGINA) {
    const { data } = await sb.from("sales_items")
      .select("sale_id,net_amount")
      .in("sale_id", semCabecalho.slice(i, i + PAGINA));
    for (const it of ((data ?? []) as any[])) {
      porLinhas.set(it.sale_id, (porLinhas.get(it.sale_id) ?? 0) + Number(it.net_amount || 0));
    }
  }

  const faturamento = vendas.reduce(
    (s, v) => s + (v.net || porLinhas.get(v.id) || 0), 0
  );

  return {
    desde, ate: hoje,
    faturamento: Math.round(faturamento * 100) / 100,
    documentos: vendas.length,
    registadoParaVat: registado,
    aviso: avisoDeLimiarVat(faturamento, registado),
  };
}

export type LinhaDeLimiar = {
  clientId: string;
  clientCode: string | null;
  clientName: string;
  faturamento: number;
  usoDoMenorLimiar: number;
  estado: "passou" | "aproxima";
  motivo: "aproxima" | "passouServicos" | "passouAmbos";
  limiarServicos: number;
  limiarBens: number;
};

/**
 * A mesma leitura, para TODOS os clientes de uma vez.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EM LOTE, E NÃO UM POR UM
 *
 * A versão por cliente só serve a quem já abriu o cliente — e quem já suspeita
 * já foi ver. O caso que custa dinheiro é o outro: o cliente em que ninguém
 * está a pensar, que passou o limiar em março e continua a faturar sem IVA.
 *
 * Num escritório com trinta e cinco empresas, uma leitura por cliente seriam
 * setenta consultas e mais de um minuto — ou seja, uma tela que ninguém abre.
 * Aqui é uma varredura das vendas de doze meses, agrupada em memória.
 * ---------------------------------------------------------------------------
 *
 * Devolve SÓ quem está a passar ou perto. Um relatório com trinta e cinco
 * linhas verdes esconde as duas que interessam.
 */
export async function limiarDeTodos(
  clientIds: string[],
  hoje = new Date().toISOString().slice(0, 10)
): Promise<{ desde: string; ate: string; clientesOlhados: number; linhas: LinhaDeLimiar[] }> {
  const desde = umAnoAntes(hoje);
  const vazio = { desde, ate: hoje, clientesOlhados: 0, linhas: [] as LinhaDeLimiar[] };
  if (!clientIds.length) return vazio;

  const sb = getServerSupabase();

  // Só os NÃO registados entram: quem já tem número de VAT não tem limiar para
  // passar, e varrer as vendas dele seria trabalho para deitar fora.
  const { data: clientes } = await sb.from("clients")
    .select("id,client_code,name,vat_number").in("id", clientIds);
  const candidatos = ((clientes ?? []) as any[]).filter((c) => !c.vat_number?.trim());
  if (!candidatos.length) return vazio;

  const ids = candidatos.map((c) => c.id);
  const porCliente = new Map<string, number>();
  const semCabecalho: { id: string; clientId: string }[] = [];

  for (let inicio = 0; ; inicio += PAGINA) {
    const { data } = await sb.from("sales")
      .select("id,client_id,net_amount")
      .in("client_id", ids)
      .gte("entry_date", desde).lte("entry_date", hoje)
      .range(inicio, inicio + PAGINA - 1);
    const lote = (data ?? []) as any[];
    for (const s of lote) {
      const net = Number(s.net_amount || 0);
      if (net) porCliente.set(s.client_id, (porCliente.get(s.client_id) ?? 0) + net);
      else semCabecalho.push({ id: s.id, clientId: s.client_id });
    }
    if (lote.length < PAGINA) break;
  }

  // A mesma queda para as linhas — ver o comentário em `leituraDeLimiar`.
  const doCliente = new Map(semCabecalho.map((s) => [s.id, s.clientId]));
  for (let i = 0; i < semCabecalho.length; i += PAGINA) {
    const { data } = await sb.from("sales_items")
      .select("sale_id,net_amount")
      .in("sale_id", semCabecalho.slice(i, i + PAGINA).map((s) => s.id));
    for (const it of ((data ?? []) as any[])) {
      const c = doCliente.get(it.sale_id);
      if (c) porCliente.set(c, (porCliente.get(c) ?? 0) + Number(it.net_amount || 0));
    }
  }

  const linhas: LinhaDeLimiar[] = [];
  for (const c of candidatos) {
    const aviso = avisoDeLimiarVat(porCliente.get(c.id) ?? 0, false);
    if (!aviso || aviso.estado === "ok") continue;
    linhas.push({
      clientId: c.id, clientCode: c.client_code ?? null, clientName: c.name,
      faturamento: aviso.faturamento,
      usoDoMenorLimiar: aviso.usoDoMenorLimiar,
      estado: aviso.estado,
      motivo: aviso.motivo as LinhaDeLimiar["motivo"],
      limiarServicos: aviso.limiarServicos,
      limiarBens: aviso.limiarBens,
    });
  }

  // Quem está mais longe do limiar vem por último: a ordem é a da urgência.
  linhas.sort((a, b) => b.faturamento - a.faturamento);
  return { desde, ate: hoje, clientesOlhados: candidatos.length, linhas };
}
