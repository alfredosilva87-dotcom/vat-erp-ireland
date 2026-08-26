import "server-only";
import { getServerSupabase } from "@/lib/supabase";

/**
 * O resumo de pagar e receber: quanto, quando, e o que está a meio.
 *
 * ---------------------------------------------------------------------------
 * POR QUE EXISTE, E POR QUE OS PARCIAIS VÊM À PARTE
 *
 * "Quanto tenho a receber" é uma pergunta de painel, e até aqui a resposta só
 * existia dentro da tela de contas a receber, atrás de um filtro. Quem abria o
 * painel do cliente via imposto e faturação e não via dinheiro.
 *
 * Os **parciais** vêm numa lista própria, e não diluídos no total, porque são
 * o caso que exige decisão. Um título em aberto espera o vencimento; um título
 * quitado acabou; um título PARCIAL tem alguém do outro lado que pagou parte e
 * parou — e é sobre esse que se liga a perguntar. Somado ao resto, desaparece.
 *
 * É também o mais próximo que se consegue de um mapa de parcelas sem inventar
 * a estrutura de parcelas: mostra o que foi pago, quanto falta e para quando.
 * ---------------------------------------------------------------------------
 */

export type ResumoLado = {
  /** Quantos títulos ainda não estão quitados. */
  titulos: number;
  /** Soma do que está por receber/pagar. */
  aberto: number;
  /** Do aberto, o que já passou do vencimento. */
  vencido: number;
  /** Do aberto, o que vence nos próximos 30 dias. */
  aVencer30: number;
  /** Quantos estão parcialmente pagos. */
  parciais: number;
  /** Do aberto, quanto está preso em títulos parcialmente pagos. */
  abertoEmParciais: number;
};

export type TituloParcial = {
  id: string;
  kind: "payable" | "receivable";
  documentRef: string | null;
  contraparte: string | null;
  dueDate: string | null;
  original: number;
  encargos: number;
  pago: number;
  aberto: number;
  /** Percentagem já paga, para a barra da tela. 0–100. */
  pagoPct: number;
  vencido: boolean;
};

export type Aging = {
  payable: ResumoLado;
  receivable: ResumoLado;
  /** Os parcialmente pagos, do mais antigo vencimento para o mais recente. */
  parciais: TituloParcial[];
};

const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const vazio = (): ResumoLado => ({
  titulos: 0, aberto: 0, vencido: 0, aVencer30: 0, parciais: 0, abertoEmParciais: 0,
});

export async function agingDoCliente(clientId: string): Promise<Aging> {
  const sb = getServerSupabase();

  const hoje = new Date().toISOString().slice(0, 10);
  const daqui30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  /*
   * Lê os NÃO quitados, não a tabela inteira.
   *
   * Um cliente com anos de movimento tem milhares de títulos e a esmagadora
   * maioria está paga. Trazê-los todos para somar quatro números é lento e não
   * muda nenhum deles — `status <> 'settled'` já é o universo da pergunta.
   */
  const { data, error } = await sb.from("ledger_items_open")
    .select("id,kind,document_ref,counterparty,due_date,original_amount," +
            "charges_amount,settled_amount,outstanding_amount,status")
    .eq("client_id", clientId)
    .neq("status", "settled")
    .limit(20000);
  if (error) throw new Error(error.message);

  const r: Aging = { payable: vazio(), receivable: vazio(), parciais: [] };

  for (const t of ((data ?? []) as any[])) {
    const lado: ResumoLado = t.kind === "payable" ? r.payable : r.receivable;
    const aberto = num(t.outstanding_amount);
    const pago = num(t.settled_amount);

    lado.titulos += 1;
    lado.aberto += aberto;
    if (t.status === "overdue" || (t.due_date && t.due_date < hoje)) lado.vencido += aberto;
    else if (t.due_date && t.due_date <= daqui30) lado.aVencer30 += aberto;

    // Parcial é `pago > 0` e não o `status`: um título parcialmente pago que
    // JÁ passou do vencimento tem status "partial" na vista, mas um que passe
    // a vencido noutra regra deixaria de ser contado — e continua parcial.
    if (pago > 0) {
      lado.parciais += 1;
      lado.abertoEmParciais += aberto;
      const original = num(t.original_amount);
      const encargos = num(t.charges_amount);
      const devido = original + encargos;
      r.parciais.push({
        id: t.id, kind: t.kind,
        documentRef: t.document_ref ?? null,
        contraparte: t.counterparty ?? null,
        dueDate: t.due_date ?? null,
        original, encargos, pago, aberto,
        pagoPct: devido > 0 ? Math.round((pago / devido) * 100) : 0,
        vencido: Boolean(t.due_date && t.due_date < hoje),
      });
    }
  }

  for (const lado of [r.payable, r.receivable]) {
    lado.aberto = num(lado.aberto);
    lado.vencido = num(lado.vencido);
    lado.aVencer30 = num(lado.aVencer30);
    lado.abertoEmParciais = num(lado.abertoEmParciais);
  }

  // Vencimento mais antigo primeiro: é a ordem por que se liga a cobrar.
  // Sem data vai para o fim, porque não se sabe quando cobrar.
  r.parciais.sort((a, b) =>
    (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")
    || (a.documentRef ?? "").localeCompare(b.documentRef ?? ""));

  return r;
}
