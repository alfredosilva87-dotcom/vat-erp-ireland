/**
 * O NÚMERO COMO O WHATSAPP O QUER.
 *
 * ---------------------------------------------------------------------------
 * TIRAR O QUE NÃO É DÍGITO NÃO CHEGA — E É AQUI QUE TODA A GENTE FALHA
 *
 * Os telefones do escritório vieram de uma folha de Excel escritos à maneira
 * de cá: `353 087 063 2331`. O `0` do `087` é o **prefixo nacional** — serve
 * para marcar de dentro do país e **não** entra no formato internacional.
 *
 * Deixá-lo lá dá `3530870632331`, um número que não existe. O link abre, o
 * WhatsApp diz que o contacto é inválido, e a conclusão de quem está a usar é
 * que o sistema está partido — quando o que está errado é um zero.
 *
 * A lista de indicativos é curta de propósito: só os países que aparecem nestes
 * clientes. Um número de outro lado entra como está, que é melhor do que
 * adivinhar mal e produzir um número que não existe.
 *
 * (A regra e a lista vêm do sistema do Matheus, onde já tinham sido
 * descobertas contra os 35 números reais do escritório. Reescrever a regra de
 * novo seria repetir o mesmo erro para o voltar a descobrir.)
 */

/** Indicativos onde o prefixo nacional `0` se remove. */
const CC_COM_TRUNCO = ["353", "351", "44", "55", "34"];

/**
 * O PAÍS POR OMISSÃO, para números escritos à maneira de cá.
 *
 * ---------------------------------------------------------------------------
 * O SEGUNDO DEFEITO, QUE SÓ APARECEU COM OS DADOS A SÉRIO
 *
 * A primeira versão sabia tirar o `0` DEPOIS de um indicativo
 * (`353 087 …` → `35387 …`) e parava aí. Mas no cadastro deste escritório os
 * telefones estão em formato NACIONAL — `0838380361`, sem indicativo nenhum —,
 * que é como toda a gente os escreve e como vieram do Excel.
 *
 * Sem indicativo o link saía `wa.me/0838380361`, e o WhatsApp respondia
 * "This link couldn't be opened". Foi exactamente o que ele viu.
 *
 * Um número que começa por UM `0` (e não `00`) é, por definição, nacional: o
 * `0` é o prefixo de marcação interna. Troca-se pelo indicativo do país do
 * escritório, que aqui é a Irlanda.
 *
 * É uma suposição, e por isso o número corrigido aparece à vista no ecrã
 * (`waMostrar` mostra-o já com o `+`): um `+353` errado vê-se antes de alguém
 * carregar no botão.
 */
const PAIS_POR_OMISSAO = "353";

/** Menos do que isto não é telefone nenhum — é lixo no cadastro. */
const MINIMO_DE_DIGITOS = 7;

export function waNumber(phone: string | null | undefined): string {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  // `00` à frente é a forma antiga de escrever o `+`.
  if (d.startsWith("00")) d = d.slice(2);

  for (const cc of CC_COM_TRUNCO) {
    if (!d.startsWith(cc)) continue;
    // Já traz indicativo: só se tira o prefixo nacional, se lá estiver.
    return d.length < MINIMO_DE_DIGITOS ? ""
      : (d[cc.length] === "0" ? cc + d.slice(cc.length + 1) : d);
  }

  // Formato nacional: o `0` da frente é prefixo de marcação, e sai com o
  // indicativo do país a entrar no lugar dele.
  if (d.startsWith("0")) d = PAIS_POR_OMISSAO + d.slice(1);

  return d.length < MINIMO_DE_DIGITOS ? "" : d;
}

/**
 * O endereço da conversa, com a mensagem já escrita.
 *
 * Devolve `null` quando não há número — para quem chama poder mostrar o ícone
 * apagado em vez de um link que não leva a lado nenhum. Um botão que abre uma
 * página de erro é pior do que um botão visivelmente desligado.
 */
export function waLink(phone: string | null | undefined, texto?: string | null): string | null {
  const n = waNumber(phone);
  if (!n) return null;
  const t = String(texto ?? "").trim();
  return `https://wa.me/${n}${t ? `?text=${encodeURIComponent(t)}` : ""}`;
}

/**
 * O número como se mostra a uma pessoa: `+353 87 063 2331`.
 *
 * Só para leitura — o que vai no link é sempre `waNumber`.
 */
export function waMostrar(phone: string | null | undefined): string {
  const n = waNumber(phone);
  return n ? `+${n}` : "—";
}
