/**
 * A ASSINATURA QUE A REVENUE EXIGE EM CADA PEDIDO.
 *
 * ---------------------------------------------------------------------------
 * O QUE É, EM UMA FRASE
 *
 * Todo o pedido aos serviços de PAYE do ROS que devolva informação confidencial
 * ou aceite uma submissão tem de levar um cabeçalho `Signature`. Sem ele — ou
 * com ele errado — a resposta é `401`, e mais nada. Não há chave de API, não há
 * token: é uma assinatura RSA feita com a chave privada do certificado digital
 * do escritório.
 *
 * Fonte: *REST Web Service Integration Guide*, PAYE Modernisation (Revenue),
 * secção 4. O formato é o do rascunho `draft-cavage-http-signatures-08`, na
 * variante **cabeçalho `Signature`** (não o esquema de autenticação).
 *
 * ---------------------------------------------------------------------------
 * A FORMA, VERBATIM DO GUIA
 *
 *   Signature: keyId="MIICfzCCAeigAwIBAgIJ...",
 *              algorithm="rsa-sha512",
 *              headers="(request-target) host date digest",
 *              signature="GdUqDgy94Z8mSYUjr/rL6qrLX/jmudS..."
 *
 *   keyId     — o certificado X509 em base64 (o certificado, não a chave).
 *   algorithm — `rsa-sha512`, sempre.
 *   headers   — a lista, em minúsculas, POR ORDEM. `digest` é obrigatório no POST.
 *   signature — base64 da assinatura da "signing string".
 *
 * ---------------------------------------------------------------------------
 * ONDE ISTO COSTUMA CORRER MAL, E PORQUE ESTE MÓDULO É PURO
 *
 * A signing string é uma concatenação com regras que não perdoam: ordem dos
 * cabeçalhos igual à declarada, nome em minúsculas, dois pontos, UM espaço,
 * `\n` entre linhas mas **não** no fim, e o `(request-target)` a juntar método
 * em minúsculas com o caminho E a query. Um espaço a mais em qualquer sítio dá
 * `401` — e um `401` não diz qual foi o espaço.
 *
 * Por isso a construção da string vive aqui, sozinha, sem rede e sem
 * certificado: é a única forma de a testar carácter a carácter contra o
 * exemplo publicado. A assinatura em si é uma função que se recebe de fora, o
 * que permite ao teste usar um par de chaves gerado na hora e verificar o
 * ciclo completo sem nunca precisar do certificado real do escritório.
 */

/** O que entra numa assinatura. */
export interface PedidoAAssinar {
  /** `get` | `post` — vai em minúsculas para o `(request-target)`. */
  metodo: string;
  /** Caminho COM a query string, tal como vai na linha do pedido. */
  caminho: string;
  /** O host, sem esquema. Ex.: `softwaretestnextversion.ros.ie`. */
  host: string;
  /** Instante do pedido, em ISO 8601. Vale ±90 minutos. */
  data: string;
  /** Só no POST: o corpo, para o `Digest`. */
  corpo?: string;
  /** Só no POST. O guia exige `application/json` ou com charset. */
  contentType?: string;
}

/**
 * Os cabeçalhos que entram na assinatura, por ordem.
 *
 * O GET não leva `digest` porque não tem corpo — e declarar um `digest` que não
 * existe é uma das formas de apanhar `401` sem perceber porquê.
 */
export function cabecalhosAssinados(temCorpo: boolean): string[] {
  return temCorpo
    ? ["(request-target)", "host", "date", "digest"]
    : ["(request-target)", "host", "date"];
}

/**
 * O `Digest`, que é o corpo em SHA-512 e base64.
 *
 * Recebe o digestor de fora pela mesma razão que a assinatura: mantém este
 * ficheiro puro e testável, e deixa o servidor usar `node:crypto`.
 */
export type Sha512Base64 = (dados: string) => string;

/**
 * A SIGNING STRING.
 *
 * Isto é o coração, e é onde os `401` nascem. As regras, do guia:
 *
 *  - `(request-target)`: método em MINÚSCULAS + um espaço + caminho com query.
 *  - Os restantes: nome em minúsculas + `:` + UM espaço + valor, sem espaços
 *    à volta do valor.
 *  - Linhas separadas por `\n`. **Sem `\n` no fim** — um newline final muda o
 *    que se assina e a Revenue rejeita.
 */
export function signingString(p: PedidoAAssinar, sha512b64?: Sha512Base64): string {
  const temCorpo = p.corpo !== undefined && p.corpo !== null;
  const linhas: string[] = [];

  for (const h of cabecalhosAssinados(temCorpo)) {
    if (h === "(request-target)") {
      linhas.push(`(request-target): ${p.metodo.toLowerCase()} ${p.caminho}`);
    } else if (h === "host") {
      linhas.push(`host: ${p.host.trim()}`);
    } else if (h === "date") {
      linhas.push(`date: ${p.data.trim()}`);
    } else if (h === "digest") {
      if (!sha512b64) throw new Error("O POST precisa de um digestor para o cabeçalho Digest.");
      linhas.push(`digest: ${digest(p.corpo ?? "", sha512b64)}`);
    }
  }
  return linhas.join("\n");
}

/**
 * O valor do cabeçalho `Digest`.
 *
 * O guia diz "hashed using the SHA-512 algorithm and finally base64 encoded".
 * O prefixo `SHA-512=` é o do RFC 3230, que a especificação de HTTP Signatures
 * pressupõe — e é assim que os exemplos do próprio ROS o mostram.
 */
export function digest(corpo: string, sha512b64: Sha512Base64): string {
  return `SHA-512=${sha512b64(corpo)}`;
}

/** Quem assina: recebe a string, devolve a assinatura em base64. */
export type Assinador = (signingString: string) => string;

export interface CabecalhosProntos {
  Date: string;
  Signature: string;
  Digest?: string;
  "Content-Type"?: string;
}

/**
 * Monta os cabeçalhos do pedido, assinatura incluída.
 *
 * `certificadoBase64` é o X509 **sem** as linhas `-----BEGIN CERTIFICATE-----`
 * e sem quebras — é o que o campo `keyId` espera. A chave privada nunca passa
 * por aqui: ela vive dentro do `assinador`, e este módulo nunca lhe toca.
 */
export function montarCabecalhos(
  p: PedidoAAssinar,
  certificadoBase64: string,
  assinar: Assinador,
  sha512b64?: Sha512Base64
): CabecalhosProntos {
  const temCorpo = p.corpo !== undefined && p.corpo !== null;
  const str = signingString(p, sha512b64);
  const assinatura = assinar(str);

  const headers = cabecalhosAssinados(temCorpo).join(" ");
  const out: CabecalhosProntos = {
    Date: p.data,
    Signature:
      `keyId="${certificadoBase64}",` +
      `algorithm="rsa-sha512",` +
      `headers="${headers}",` +
      `signature="${assinatura}"`,
  };
  if (temCorpo) {
    out.Digest = digest(p.corpo ?? "", sha512b64!);
    out["Content-Type"] = p.contentType ?? "application/json";
  }
  return out;
}

/**
 * A data no formato que o guia aceita, em GMT.
 *
 * `toISOString()` do JavaScript dá exactamente `yyyy-MM-ddTHH:mm:ss.SSSZ`, que
 * é o ISO 8601 pedido, sempre em UTC. O guia insiste em dois dígitos no dia e
 * no mês; o `toISOString` já garante isso, e é por isso que não se constrói a
 * data à mão — construí-la à mão é onde nasce o `2018-1-1` que ele proíbe.
 */
export function agoraParaRevenue(quando: Date = new Date()): string {
  return quando.toISOString();
}

/**
 * O pedido ainda está dentro da janela que a Revenue aceita?
 *
 * 90 minutos para cada lado, diz o guia — a folga para trás existe por causa
 * de relógios dessincronizados e da mudança de hora. Isto serve para o produto
 * poder dizer "o relógio desta máquina está errado" em vez de deixar o
 * utilizador a olhar para um `401` inexplicável.
 */
export const JANELA_MS = 90 * 60 * 1000;

export function dentroDaJanela(dataDoPedido: string, agora: Date = new Date()): boolean {
  const t = Date.parse(dataDoPedido);
  if (Number.isNaN(t)) return false;
  return Math.abs(agora.getTime() - t) <= JANELA_MS;
}
