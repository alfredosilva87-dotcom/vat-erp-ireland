import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import { periodoTravado } from "@/lib/accounting/periodos";

/**
 * Tirar do razão o que lá não devia estar — estornando ou apagando.
 *
 * ---------------------------------------------------------------------------
 * AS DUAS OPERAÇÕES SÃO DIFERENTES, E CONFUNDI-LAS ESTRAGA UMA DELAS
 *
 * **Estornar** é o que se faz a um FACTO que existiu e ficou errado. A partida
 * original fica onde está e nasce a espelhada, com a mesma data ou a data de
 * hoje conforme o período. Nada desaparece — e é por isso que é o único
 * caminho possível num período fechado.
 *
 * **Apagar** é o que se faz ao LIXO: a partida cuja origem já não existe, que
 * nunca devia ter ficado. Estornar lixo com lixo duplica as linhas que alguém
 * vai ter de explicar, em vez de as reduzir.
 *
 * Nos dois casos fica o registo em `journal_removals`, com o lançamento
 * inteiro em JSON. É o que faz de apagar uma decisão registada em vez de um
 * buraco: depois de a linha sair, a única cópia é essa.
 * ---------------------------------------------------------------------------
 *
 * O período fechado é travado por GATILHO no banco (migração 039), e não aqui.
 * A verificação nesta função existe só para dar uma mensagem que se entende —
 * a do gatilho é correcta e ilegível. Nunca é ela a rede.
 */

export type Remocao = {
  ok: boolean;
  erro?: string;
  /** Quando foi estorno, o lançamento espelhado que nasceu. */
  estornoId?: string | null;
};

const hoje = () => new Date().toISOString().slice(0, 10);

/** O lançamento inteiro — cabeçalho e linhas — como está agora. */
async function fotografar(clientId: string, journalId: string) {
  const sb = getServerSupabase();
  const { data: cab } = await sb.from("journal")
    .select("*").eq("id", journalId).eq("client_id", clientId).maybeSingle();
  if (!cab) return null;
  const { data: linhas } = await sb.from("journal_lines")
    .select("*").eq("journal_id", journalId).order("line_no", { ascending: true });
  return { cabecalho: cab as any, linhas: ((linhas ?? []) as any[]) };
}

export async function removerLancamento(args: {
  clientId: string;
  journalId: string;
  acao: "reverse" | "delete";
  motivo: string;
  nota?: string | null;
  userId?: string | null;
}): Promise<Remocao> {
  const sb = getServerSupabase();

  const foto = await fotografar(args.clientId, args.journalId);
  if (!foto) return { ok: false, erro: "Lançamento não encontrado neste cliente." };
  if (!foto.linhas.length) return { ok: false, erro: "Lançamento sem linhas." };

  /*
   * Um estorno não se estorna outra vez.
   *
   * Sem esta trava, dois cliques no mesmo botão deixavam três lançamentos onde
   * havia um, todos balanceados, e o razão ficava com o dobro das linhas a
   * explicar. O `reverses` já diz que este lançamento é o espelho de outro.
   */
  if (args.acao === "reverse" && foto.cabecalho.reverses) {
    return { ok: false, erro: "Este lançamento já é o estorno de outro." };
  }
  const { data: jaEstornado } = await sb.from("journal")
    .select("id").eq("reverses", args.journalId).maybeSingle();
  if (args.acao === "reverse" && jaEstornado) {
    return { ok: false, erro: "Este lançamento já foi estornado." };
  }

  const dataOriginal = String(foto.cabecalho.posting_date).slice(0, 10);

  if (args.acao === "delete") {
    /*
     * Apagar em período FECHADO não acontece — nem aqui nem no gatilho.
     *
     * A mensagem própria existe porque a do gatilho fala de constraint e de
     * trigger, e quem a lê está a tentar arrumar a contabilidade de um cliente,
     * não a ler um erro de Postgres. Diz-se o que fazer: estornar, ou reabrir.
     */
    if ((await periodoTravado(args.clientId, dataOriginal, dataOriginal)).fechado) {
      return {
        ok: false,
        erro: `O período de ${dataOriginal} está fechado, e apagar reescreveria `
          + "um mês já entregue. Estorne — a partida original fica à vista e o "
          + "efeito sai na mesma. Ou reabra o período, se foi mesmo um engano de lançamento.",
      };
    }
  }

  let estornoId: string | null = null;

  if (args.acao === "reverse") {
    /*
     * A DATA do estorno segue o período, e não a preferência de quem clica.
     *
     * Estornar na data original é o que mantém o mês certo — o erro e a
     * correcção no mesmo mês, e o DRE de Março deixa de contar o que nunca foi
     * de Março. Só que isso reescreve um mês fechado, que é justamente o que o
     * cadeado impede. Então: data original quando o período está aberto, hoje
     * quando está fechado.
     */
    const travado = (await periodoTravado(args.clientId, dataOriginal, dataOriginal)).fechado;
    const data = travado ? hoje() : dataOriginal;
    if (travado && (await periodoTravado(args.clientId, data, data)).fechado) {
      return { ok: false, erro: "O período de hoje também está fechado — reabra um deles para poder estornar." };
    }

    const { data: cab, error: e1 } = await sb.from("journal").insert({
      client_id: args.clientId,
      entry_date: data, posting_date: data,
      /*
       * O estorno entra como `manual`, e não com a origem do original.
       *
       * Duas razões, e a segunda é uma trava do banco:
       *
       *   1. Ele NÃO herda o `document_id`. Herdá-lo faria o `jaContabilizado`
       *      encontrar o estorno e concluir que o documento já está no razão —
       *      e uma recontabilização legítima passaria a ser recusada em
       *      silêncio, para sempre.
       *   2. `journal_origem_check` exige `document_id` em tudo o que não é
       *      `manual` nem `opening`. Um estorno de encargo a herdar `charge`
       *      com documento nulo é recusado pelo banco — foi o que aconteceu ao
       *      testar. `manual` é a descrição honesta na mesma: um estorno é uma
       *      correcção lançada por uma pessoa, não a leitura de um documento.
       *
       * O que liga o estorno ao original é o `reverses`, que é o rasto a sério.
       */
      source_module: "manual",
      document_id: null,
      document_ref: foto.cabecalho.document_ref,
      description: `Estorno — ${foto.cabecalho.description ?? args.journalId.slice(0, 8)}`,
      reverses: args.journalId,
      created_by: args.userId ?? null,
    }).select("id").single();
    if (e1 || !cab) return { ok: false, erro: e1?.message || "Não criou o estorno." };
    estornoId = (cab as any).id;

    // Débito vira crédito e crédito vira débito. É só isso um estorno, e é por
    // isso que ele nasce balanceado sem ninguém ter de o verificar.
    const { error: e2 } = await sb.from("journal_lines").insert(
      foto.linhas.map((l, i) => ({
        journal_id: estornoId, line_no: i + 1,
        account_code: l.account_code,
        debit: Number(l.credit) || 0,
        credit: Number(l.debit) || 0,
        description: l.description, resolved_by: "reversal",
      }))
    );
    if (e2) {
      // Cabeçalho sem linhas é um lançamento vazio que aparece em todo o lado e
      // não diz nada. Não fica.
      await sb.from("journal").delete().eq("id", estornoId);
      return { ok: false, erro: e2.message };
    }
  }

  /*
   * O REGISTO vem ANTES de apagar.
   *
   * Ao contrário: se o registo falhasse, o lançamento já tinha saído e a única
   * cópia dele tinha-se perdido junto. Nesta ordem, o pior caso é um registo a
   * mais de uma remoção que não aconteceu — que se lê e se percebe.
   */
  const { error: eReg } = await sb.from("journal_removals").insert({
    client_id: args.clientId,
    journal_id: args.journalId,
    action: args.acao,
    reason: args.motivo,
    note: (args.nota ?? "").trim() || null,
    snapshot: foto,
    reversal_journal_id: estornoId,
    removed_by: args.userId ?? null,
  });
  if (eReg) {
    if (estornoId) await sb.from("journal").delete().eq("id", estornoId);
    return { ok: false, erro: `Não gravou o registo da remoção: ${eReg.message}` };
  }

  if (args.acao === "delete") {
    const { error } = await sb.from("journal")
      .delete().eq("id", args.journalId).eq("client_id", args.clientId);
    if (error) return { ok: false, erro: error.message };
  }

  return { ok: true, estornoId };
}
