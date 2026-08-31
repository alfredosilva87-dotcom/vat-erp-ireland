import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { integracoesDo } from "@/lib/integrations";
import { conciliarControlo } from "@/lib/financial/control";
import { documentosNaoIntegrados } from "@/lib/financial/naoIntegrados";

/**
 * A varredura a pedido: o que, neste cliente, não fecha.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UMA ROTINA, SE JÁ HÁ AVISOS ESPALHADOS
 *
 * Há hoje três sítios que acusam problema: a conciliação da conta de controlo
 * em contas a pagar/receber, a tela de documentos não integrados, e a
 * diferença no rodapé do balanço. Cada um vê a sua fatia, e nenhum vê o
 * conjunto — para saber se o cliente está bem é preciso abrir os três e somar
 * de cabeça.
 *
 * Pior: alguns estados não aparecem em sítio nenhum. Um título cujo documento
 * foi apagado some das duas telas ao mesmo tempo, e a conta de controlo
 * continua a fechar porque os dois lados ficaram órfãos JUNTOS.
 *
 * Esta rotina existe para responder a uma pergunta só — "posso confiar nos
 * números deste cliente?" — com um botão, antes de fechar o mês ou de entregar
 * uma declaração.
 * ---------------------------------------------------------------------------
 *
 * A REGRA que governa cada verificação: distinguir DEFEITO de CONFIGURAÇÃO.
 *
 * Custou uma correcção aprender isto. Um cliente que não integra contabilidade
 * tem, por desenho, documentos sem partida — marcá-los como avaria faz a lista
 * encher de coisas que ninguém tem de tratar, e uma lista assim deixa de ser
 * lida. Cada verificação abaixo diz explicitamente o que considera normal.
 */

export type Estado = "ok" | "aviso" | "erro";

export type Achado = {
  /** O que identificar na tela: número de documento, código de conta. */
  referencia: string;
  detalhe: string;
  /** Para onde a pessoa vai resolver. */
  href?: string | null;
};

export type Verificacao = {
  id: string;
  titulo: string;
  /** O que esta verificação procura, em uma frase. */
  procura: string;
  estado: Estado;
  /** A frase de resultado — o que se encontrou, ou porque está bem. */
  resumo: string;
  achados: Achado[];
};

export type Checkup = {
  clientId: string;
  correuEm: string;
  estado: Estado;
  verificacoes: Verificacao[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => r2(Number(v) || 0);

/** O pior estado de uma lista — é ele que resume o conjunto. */
const pior = (es: Estado[]): Estado =>
  es.includes("erro") ? "erro" : es.includes("aviso") ? "aviso" : "ok";

export async function checkupDoCliente(clientId: string): Promise<Checkup> {
  const sb = getServerSupabase();
  const integra = await integracoesDo(clientId);
  const vs: Verificacao[] = [];

  // ------------------------------------------------ 1. partidas dobradas
  /*
   * O gatilho do banco já recusa lançamento desbalanceado, então isto devia
   * ser sempre zero. Verifica-se na mesma: uma correcção feita por SQL, uma
   * migração, ou um gatilho desactivado por engano passam por fora dele, e é
   * justamente quando a rede falha que se quer saber.
   */
  {
    const { data: linhas } = await sb.from("journal_lines")
      .select("journal_id,debit,credit,journal!inner(client_id,document_ref)")
      .eq("journal.client_id", clientId).limit(20000);

    const porLanc = new Map<string, { d: number; c: number; ref: string | null }>();
    for (const l of ((linhas ?? []) as any[])) {
      const a = porLanc.get(l.journal_id) ?? { d: 0, c: 0, ref: l.journal?.document_ref ?? null };
      a.d += Number(l.debit) || 0;
      a.c += Number(l.credit) || 0;
      porLanc.set(l.journal_id, a);
    }
    const tortos = [...porLanc.entries()].filter(([, a]) => Math.abs(a.d - a.c) > 0.004);
    vs.push({
      id: "balanco-partidas",
      titulo: "Partidas dobradas",
      procura: "Lançamento cujo débito não é igual ao crédito.",
      estado: tortos.length ? "erro" : "ok",
      resumo: tortos.length
        ? `${tortos.length} lançamento(s) fora de balanço.`
        : `Os ${porLanc.size} lançamentos fecham, cada um por si.`,
      achados: tortos.slice(0, 20).map(([id, a]) => ({
        referencia: a.ref || id.slice(0, 8),
        detalhe: `débito ${r2(a.d)} contra crédito ${r2(a.c)} — diferença ${r2(a.d - a.c)}`,
      })),
    });
  }

  // ------------------------------------- 2. contas usadas fora do plano
  /*
   * Conta que não existe no plano, está inactiva ou é sintética: o
   * `trial_balance` faz `left join`, então a linha fica sem natureza e é
   * DESCARTADA do balancete, do DRE e do balanço. O lançamento continua lá,
   * balanceado, e metade dele deixa de ser contada — o balanço passa a não
   * fechar sem causa apontável.
   */
  {
    const { data: usadas } = await sb.from("journal_lines")
      .select("account_code,journal!inner(client_id)")
      .eq("journal.client_id", clientId).limit(20000);
    const codigos = Array.from(new Set(((usadas ?? []) as any[]).map((l) => l.account_code)));

    const { data: plano } = await sb.from("chart_of_accounts")
      .select("code,active,postable,type").or(`client_id.is.null,client_id.eq.${clientId}`);
    const boas = new Set(((plano ?? []) as any[])
      .filter((c) => c.active && c.postable && c.type)
      .map((c) => c.code));
    const orfas = codigos.filter((c) => !boas.has(c));

    vs.push({
      id: "contas-fora-do-plano",
      titulo: "Contas usadas no razão",
      procura: "Conta lançada que não existe no plano, está inactiva, é sintética ou não tem natureza.",
      estado: orfas.length ? "erro" : "ok",
      resumo: orfas.length
        ? `${orfas.length} conta(s) usada(s) no razão que os relatórios vão ignorar.`
        : `As ${codigos.length} contas usadas existem no plano e têm natureza.`,
      achados: orfas.map((c) => ({
        referencia: c,
        detalhe: "os lançamentos nesta conta saem do balancete e do balanço em silêncio",
        href: `/clients/${clientId}/accounts`,
      })),
    });
  }

  // ---------------------------------------- 3. conta de controlo × aging
  for (const kind of ["payable", "receivable"] as const) {
    const liga = kind === "payable" ? integra.purchases_to_payable : integra.sales_to_receivable;
    const nome = kind === "payable" ? "Contas a pagar" : "Contas a receber";
    if (!liga || !integra.documents_to_accounting) {
      vs.push({
        id: `controlo-${kind}`,
        titulo: `${nome} × razão`,
        procura: "O saldo da conta de controlo tem de ser o que está em aberto na lista de títulos.",
        estado: "ok",
        resumo: "Este cliente não integra este módulo — não há o que conciliar.",
        achados: [],
      });
      continue;
    }
    const c = await conciliarControlo(clientId, kind);
    const fecha = Math.abs(c.difference) <= 0.01;
    vs.push({
      id: `controlo-${kind}`,
      titulo: `${nome} × razão`,
      procura: "O saldo da conta de controlo tem de ser o que está em aberto na lista de títulos.",
      estado: fecha ? "ok" : "erro",
      resumo: fecha
        ? `Batem: € ${c.ledgerBalance.toFixed(2)} dos dois lados.`
        : `Diferença de € ${c.difference.toFixed(2)} — razão € ${c.ledgerBalance.toFixed(2)}, títulos € ${c.agingOutstanding.toFixed(2)}.`,
      achados: fecha ? [] : [{
        referencia: c.accounts.join(", "),
        detalhe: "abertura carregada em bloco, lançamento manual na conta, ou título apagado sem a partida",
        href: `/clients/${clientId}/${kind === "payable" ? "payable" : "receivable"}`,
      }],
    });
  }

  // ------------------------------------------------------- 4. órfãos
  /*
   * Título ou partida a apontar para um documento que já não existe. É o
   * estado mais difícil de ver: some das duas telas ao mesmo tempo, e a conta
   * de controlo continua a fechar porque os dois lados ficaram órfãos juntos.
   */
  {
    const [{ data: tits }, { data: lancs }, { data: notas }, { data: vendas }] = await Promise.all([
      sb.from("ledger_items").select("id,document_id,document_ref,original_amount")
        .eq("client_id", clientId).in("source_module", ["purchase", "sale"])
        .not("document_id", "is", null),
      sb.from("journal").select("id,document_id,document_ref")
        .eq("client_id", clientId).in("source_module", ["purchase", "sale"])
        .not("document_id", "is", null),
      sb.from("invoices").select("id").eq("client_id", clientId),
      sb.from("sales").select("id").eq("client_id", clientId),
    ]);
    const vivos = new Set([
      ...((notas ?? []) as any[]).map((x) => x.id),
      ...((vendas ?? []) as any[]).map((x) => x.id),
    ]);
    const tOrfaos = ((tits ?? []) as any[]).filter((t) => !vivos.has(t.document_id));
    const jOrfaos = ((lancs ?? []) as any[]).filter((j) => !vivos.has(j.document_id));
    const total = tOrfaos.length + jOrfaos.length;

    vs.push({
      id: "orfaos",
      titulo: "Títulos e partidas órfãos",
      procura: "Título ou lançamento a apontar para um documento que já foi apagado.",
      estado: total ? "erro" : "ok",
      resumo: total
        ? `${tOrfaos.length} título(s) e ${jOrfaos.length} lançamento(s) sem documento.`
        : "Todo título e toda partida têm o documento de origem no sítio.",
      achados: [
        ...tOrfaos.slice(0, 15).map((t) => ({
          referencia: t.document_ref || t.id.slice(0, 8),
          detalhe: `título de € ${num(t.original_amount)} cujo documento já não existe`,
        })),
        ...jOrfaos.slice(0, 15).map((j) => ({
          referencia: j.document_ref || j.id.slice(0, 8),
          detalhe: "partida no razão cujo documento já não existe",
        })),
      ],
    });
  }

  // ------------------------------------------- 5. meias-integrações
  {
    const r = await documentosNaoIntegrados(clientId);
    const meias = r.itens.filter((i) => i.meiaIntegracao);
    const porFazer = r.itens.length - meias.length;
    vs.push({
      id: "integracao",
      titulo: "Documentos integrados",
      procura: "Documento com título e sem partida, ou o contrário — e o que ainda não integrou.",
      estado: meias.length ? "erro" : porFazer ? "aviso" : "ok",
      resumo: meias.length
        ? `${meias.length} documento(s) com um lado só — é isto que faz a conta de controlo deixar de bater.`
        : porFazer
          ? `${porFazer} documento(s) por integrar. Não é avaria: é trabalho por fazer.`
          : "Tudo o que devia estar integrado está.",
      achados: [...meias, ...r.itens.filter((i) => !i.meiaIntegracao)].slice(0, 20).map((i) => ({
        referencia: i.documentRef || "(sem número)",
        detalhe: i.meiaIntegracao ? "tem um lado e não tem o outro" : i.motivo.replace(/_/g, " "),
        href: `/clients/${clientId}/unposted`,
      })),
    });
  }

  // ------------------------------------------- 6. baixa acima do devido
  {
    const { data: abertos } = await sb.from("ledger_items_open")
      .select("document_ref,original_amount,charges_amount,settled_amount,outstanding_amount")
      .eq("client_id", clientId).limit(20000);
    const acima = ((abertos ?? []) as any[]).filter((t) => num(t.outstanding_amount) < -0.01);
    vs.push({
      id: "baixa-excedida",
      titulo: "Baixas acima do devido",
      procura: "Título pago por mais do que devia — saldo em aberto negativo.",
      estado: acima.length ? "erro" : "ok",
      resumo: acima.length
        ? `${acima.length} título(s) com saldo negativo.`
        : "Nenhum título foi baixado acima do que devia.",
      achados: acima.slice(0, 15).map((t) => ({
        referencia: t.document_ref || "(sem número)",
        detalhe: `devido € ${num(t.original_amount) + num(t.charges_amount)}, baixado € ${num(t.settled_amount)}`,
      })),
    });
  }

  // -------------------------------------------- 7. saldo do lado errado
  /*
   * Conta de passivo ou património com saldo DEVEDOR, ou de activo com saldo
   * credor. NÃO é sempre erro — um banco a descoberto é legitimamente credor,
   * e por isso 1100 fica de fora — mas foi exactamente assim que a folha sem
   * provisão se manifestou: a 2400 devedora, a reduzir os credores no balanço.
   */
  {
    const { data: saldos } = await sb.from("account_balances")
      .select("account_code,account_name,type,balance").eq("client_id", clientId).limit(20000);
    const acc = new Map<string, { nome: string; tipo: string; saldo: number }>();
    for (const l of ((saldos ?? []) as any[])) {
      const a = acc.get(l.account_code) ?? { nome: l.account_name, tipo: l.type, saldo: 0 };
      a.saldo += Number(l.balance) || 0;
      acc.set(l.account_code, a);
    }
    /*
     * As contas de CAIXA saem da verificação, e a lista vem do PLANO.
     *
     * Uma conta bancária a descoberto tem saldo credor sendo activo, e isso é
     * legítimo — não é erro. Os códigos estavam cravados ("1100", "1110"), e
     * com a troca do plano de contas ficariam a apontar para contas inativas:
     * o alarme passaria a acusar todas as contas bancárias do escritório, todos
     * os dias, e um alarme que grita sempre deixa de ser lido.
     *
     * `report_group = 'cash'` é a mesma pergunta feita ao plano, e sobrevive à
     * próxima troca.
     */
    const { data: contasDeCaixa } = await sb.from("chart_of_accounts")
      .select("code").eq("report_group", "cash").is("client_id", null);
    const CAIXA = new Set(((contasDeCaixa ?? []) as any[]).map((c) => c.code));
    const invertidas = [...acc.entries()]
      .filter(([code, a]) => !CAIXA.has(code) && a.tipo && r2(a.saldo) < -0.01);

    vs.push({
      id: "saldo-invertido",
      titulo: "Contas com saldo do lado errado",
      procura: "Passivo ou património com saldo devedor, activo com saldo credor.",
      estado: invertidas.length ? "aviso" : "ok",
      resumo: invertidas.length
        ? `${invertidas.length} conta(s) com o saldo invertido. Nem sempre é erro — confira uma a uma.`
        : "Nenhuma conta está com o saldo do lado contrário à sua natureza.",
      achados: invertidas.slice(0, 15).map(([code, a]) => ({
        referencia: `${code} ${a.nome}`,
        detalhe: `${a.tipo} com saldo ${r2(a.saldo)} — falta o lançamento que a alimenta, ou foi baixada sem ter sido provisionada`,
        href: `/clients/${clientId}/ledger`,
      })),
    });
  }

  return {
    clientId,
    correuEm: new Date().toISOString(),
    estado: pior(vs.map((v) => v.estado)),
    verificacoes: vs,
  };
}
