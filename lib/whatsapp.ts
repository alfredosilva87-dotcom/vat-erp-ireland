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

export function waNumber(phone: string | null | undefined): string {
  let d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return "";
  // `00` à frente é a forma antiga de escrever o `+`.
  if (d.startsWith("00")) d = d.slice(2);
  for (const cc of CC_COM_TRUNCO) {
    if (d.startsWith(cc) && d[cc.length] === "0") {
      d = cc + d.slice(cc.length + 1);
      break;
    }
  }
  return d;
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
