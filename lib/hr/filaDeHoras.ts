import "server-only";
import { getServerSupabase } from "@/lib/supabase";
import type { Leitura } from "@/lib/hr/lerHorasDeTexto";

/**
 * PÔR NA FILA O QUE SE LEU DE UMA MENSAGEM.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ISTO SAIU DA ROTA
 *
 * Havia duas portas para a mesma coisa — colar uma mensagem no painel das horas
 * e registá-la na conversa do cliente — e a segunda ia copiar a lógica da
 * primeira. Duas cópias da regra de casamento de nomes divergem no dia em que
 * uma for corrigida, e a que não for corrigida continua a atribuir horas à
 * pessoa errada sem ninguém dar por isso.
 *
 * ---------------------------------------------------------------------------
 * ISTO NÃO TOCA NAS HORAS OFICIAIS
 *
 * O destino é `hr_hour_submissions`, que já existe e já exige aprovação. O que
 * o cliente manda é um PEDIDO de lançamento: fica fora de toda a conta até
 * alguém do escritório o aprovar. Uma leitura errada, no pior caso, produz uma
 * linha errada nesta fila — nunca um recibo errado.
 */

const simples = (s: string) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Casa um nome escrito à mão com um funcionário do cliente.
 *
 * Deliberadamente frouxo: quem escreve manda "João" e o cadastro diz
 * "João Manuel Silva". Compara-se sem acentos e sem maiúsculas, e o primeiro
 * nome basta **quando é único** — dois Joões na mesma casa não se desempatam
 * por adivinhação. Um nome que não casa vai na mesma para a fila, com
 * `employee_id` nulo: quem aprova vê o nome e escolhe a pessoa. Atribuir o
 * funcionário errado seria pior do que não atribuir nenhum.
 */
export async function casadorDeNomes(clientId: string) {
  const { data: emps } = await getServerSupabase().from("hr_employees")
    .select("id,first_name,surname").eq("client_id", clientId).eq("active", true);
  const lista = ((emps ?? []) as any[]);

  return (nome: string) => {
    const n = simples(nome);
    if (!n) return null;
    const inteiro = lista.find((e) => simples(`${e.first_name} ${e.surname}`) === n);
    if (inteiro) return inteiro;
    const porPrimeiro = lista.filter((e) => simples(e.first_name) === n);
    return porPrimeiro.length === 1 ? porPrimeiro[0] : null;
  };
}

export async function enfileirarLeitura(args: {
  clientId: string;
  leitura: Leitura;
  ano: number;
  semana: number;
  /** De onde veio: aparece na fila para quem aprova saber o que está a ver. */
  origem: string;
}): Promise<{ criadas: number; semCasar: number; erro?: string }> {
  const achar = await casadorDeNomes(args.clientId);

  const linhas = args.leitura.linhas.map((l) => {
    const emp = achar(l.nome);
    return {
      client_id: args.clientId,
      employee_id: emp?.id ?? null,
      employee_name: emp ? `${emp.first_name} ${emp.surname}`.trim() : l.nome,
      year: args.ano,
      week_no: args.semana,
      /*
       * `horasNormais`, e NÃO o total escrito.
       *
       * As colunas somam-se no cálculo do bruto. Gravar aqui o 38 de
       * "Pedro 38 (4 domingo)" a par das 4 de domingo pagaria 42 horas — ver a
       * nota em `separarOTotal`.
       */
      hours: l.horasNormais,
      sunday_hours: l.horasDomingo,
      holiday_hours: l.horasFeriado,
      week_worked: l.trabalhou,
      // A linha ORIGINAL viaja com o pedido. Quem aprova compara com o que a
      // pessoa escreveu, em vez de confiar na nossa leitura.
      note: l.origem,
      submitted_by: args.origem,
    };
  });

  if (!linhas.length) return { criadas: 0, semCasar: 0 };

  const { error } = await getServerSupabase().from("hr_hour_submissions").insert(linhas);
  if (error) return { criadas: 0, semCasar: 0, erro: error.message };

  return {
    criadas: linhas.length,
    semCasar: linhas.filter((l) => !l.employee_id).length,
  };
}
