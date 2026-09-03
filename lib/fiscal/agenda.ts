/**
 * O semáforo das obrigações: o que está atrasado, o que vence já, o que espera.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UM PAINEL DE TODOS OS CLIENTES
 *
 * As obrigações sempre existiram, mas uma tela por cliente. Num escritório com
 * trinta e cinco empresas, "o que vence esta semana" exige abrir trinta e cinco
 * telas — e o resultado previsível é que ninguém abre nenhuma até alguém
 * receber uma carta da Revenue.
 *
 * A pergunta que este painel responde é a do início do dia: **em que cliente
 * tenho de mexer hoje?**
 * ---------------------------------------------------------------------------
 *
 * Sem rede e sem banco de dados: entra a lista de obrigações e a data de hoje,
 * sai a classificação. É por isso que se consegue testar cada regra de prazo
 * com a data na mão, em vez de esperar que o calendário chegue lá.
 */

/**
 * As quatro cores, e o que cada uma quer dizer para quem olha.
 *
 * A fronteira dos 7 dias não é estética: é o que separa "tenho de tratar disto
 * esta semana" de "está na agenda". Abaixo dela a pessoa muda o que ia fazer
 * hoje; acima, não.
 */
export type Semaforo = "vermelho" | "laranja" | "amarelo" | "verde";

export const DIAS_LARANJA = 7;
export const DIAS_AMARELO = 30;

export type ObrigacaoBruta = {
  id: string;
  clientId: string;
  /** VAT3, RTD, ou o nome livre de uma obrigação criada à mão. */
  tipo: string;
  periodo: string | null;
  vencimento: string | null;
  entregue: boolean;
};

export type ObrigacaoClassificada = ObrigacaoBruta & {
  semaforo: Semaforo;
  /** Negativo = já passou. Nulo quando não há vencimento. */
  diasAteVencer: number | null;
};

const DIA = 86_400_000;

/** Dias entre duas datas ISO, contando só o dia — sem hora, sem fuso. */
export function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / DIA);
}

/**
 * A cor de uma obrigação.
 *
 * Entregue é sempre VERDE, mesmo que tenha sido entregue com atraso: o painel
 * responde "o que tenho de fazer", e o que já foi feito não é trabalho. O
 * atraso histórico é assunto de relatório, não de semáforo.
 *
 * Sem data de vencimento fica AMARELO e não verde: uma obrigação sem prazo é
 * um cadastro por completar, e pintá-la de verde esconderia isso para sempre.
 */
export function classificar(o: ObrigacaoBruta, hoje: string): ObrigacaoClassificada {
  if (o.entregue) return { ...o, semaforo: "verde", diasAteVencer: o.vencimento ? diasEntre(hoje, o.vencimento) : null };
  if (!o.vencimento) return { ...o, semaforo: "amarelo", diasAteVencer: null };

  const dias = diasEntre(hoje, o.vencimento);
  const cor: Semaforo =
    dias < 0 ? "vermelho"
    : dias <= DIAS_LARANJA ? "laranja"
    : dias <= DIAS_AMARELO ? "amarelo"
    : "verde";
  return { ...o, semaforo: cor, diasAteVencer: dias };
}

export type LinhaDoPainel = {
  clientId: string;
  clientCode: string | null;
  clientName: string;
  /** A pior cor entre as obrigações deste cliente — é ela que ordena a lista. */
  semaforo: Semaforo;
  atrasadas: number;
  vencemEm7: number;
  vencemEm30: number;
  entregues: number;
  /** As que ainda pedem acção, da mais urgente para a menos. */
  pendentes: ObrigacaoClassificada[];
};

const ORDEM: Record<Semaforo, number> = { vermelho: 0, laranja: 1, amarelo: 2, verde: 3 };

/**
 * Junta por cliente e ordena pela urgência.
 *
 * O cliente com atraso vem primeiro, e dentro dele a obrigação mais atrasada.
 * Uma lista por nome obriga a percorrer trinta e cinco linhas à procura de
 * vermelho — e o painel existe justamente para não ser preciso procurar.
 */
export function montarPainel(
  clientes: { id: string; code: string | null; name: string }[],
  obrigacoes: ObrigacaoBruta[],
  hoje: string
): LinhaDoPainel[] {
  const porCliente = new Map<string, ObrigacaoClassificada[]>();
  for (const o of obrigacoes) {
    const lista = porCliente.get(o.clientId) ?? [];
    lista.push(classificar(o, hoje));
    porCliente.set(o.clientId, lista);
  }

  const linhas: LinhaDoPainel[] = clientes.map((c) => {
    const todas = porCliente.get(c.id) ?? [];
    const pendentes = todas.filter((o) => !o.entregue);
    const atrasadas = pendentes.filter((o) => o.semaforo === "vermelho").length;
    const em7 = pendentes.filter((o) => o.semaforo === "laranja").length;
    const em30 = pendentes.filter((o) => o.semaforo === "amarelo").length;

    return {
      clientId: c.id,
      clientCode: c.code,
      clientName: c.name,
      semaforo: pendentes.length
        ? pendentes.reduce<Semaforo>((pior, o) => (ORDEM[o.semaforo] < ORDEM[pior] ? o.semaforo : pior), "verde")
        : "verde",
      atrasadas,
      vencemEm7: em7,
      vencemEm30: em30,
      entregues: todas.length - pendentes.length,
      pendentes: pendentes.sort((a, b) => {
        const oa = ORDEM[a.semaforo] - ORDEM[b.semaforo];
        if (oa !== 0) return oa;
        // Dentro da mesma cor, a mais antiga primeiro: é a que arrisca mais.
        return (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999");
      }),
    };
  });

  return linhas.sort((a, b) => {
    const o = ORDEM[a.semaforo] - ORDEM[b.semaforo];
    if (o !== 0) return o;
    if (b.atrasadas !== a.atrasadas) return b.atrasadas - a.atrasadas;
    return (a.clientCode ?? a.clientName).localeCompare(b.clientCode ?? b.clientName);
  });
}

/**
 * O resumo do topo: quantos clientes em cada estado.
 *
 * ---------------------------------------------------------------------------
 * PORQUE EXISTE UM QUARTO NÚMERO
 *
 * Eram três cartões — atrasado, vence em 7 dias, em dia — e os três somavam
 * DOIS de cinco clientes. Os outros três não estavam em cartão nenhum: um com
 * VAT3 a 20 dias (nem atrasado, nem dentro de 7, nem em dia) e outro com três
 * obrigações sem prazo.
 *
 * Três fracções do mesmo todo que não somam o todo lêem-se como se somassem, e
 * quem olha conclui que 60% da carteira não tem nada a fazer. `porVencer`
 * fecha a conta: agora os quatro cobrem todos os clientes, e o que sobra são
 * mesmo zeros.
 */
export function resumo(linhas: LinhaDoPainel[]) {
  const comAtraso = linhas.filter((l) => l.atrasadas > 0);
  const vencemEm7 = linhas.filter((l) => l.atrasadas === 0 && l.semaforo === "laranja");
  const emDia = linhas.filter((l) => l.atrasadas === 0 && l.semaforo === "verde");
  const contados = new Set([...comAtraso, ...vencemEm7, ...emDia]);
  return {
    clientes: linhas.length,
    comAtraso: comAtraso.length,
    vencemEm7: vencemEm7.length,
    emDia: emDia.length,
    /** Tudo o que os outros três não apanham — inclui o que não tem prazo. */
    porVencer: linhas.filter((l) => !contados.has(l)).length,
    obrigacoesAtrasadas: linhas.reduce((s, l) => s + l.atrasadas, 0),
  };
}
