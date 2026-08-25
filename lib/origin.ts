/**
 * Por onde um documento entrou no sistema.
 *
 * Vocabulário em UM lugar porque a mesma palavra aparece em três telas (fila
 * da caixa de entrada, lista de notas, painel do cliente) e em duas tabelas
 * (`inbox_items.source`, `invoices.source`). Duas listas divergiriam no dia em
 * que uma porta nova aparecer — e o painel passaria a contar errado sem
 * ninguém perceber, que é o pior defeito possível num indicador.
 */
import type { TKey } from "@/lib/i18n";

export type OriginKey = "upload" | "email" | "phone";

export const ORIGINS: { key: OriginKey; labelKey: TKey }[] = [
  { key: "upload", labelKey: "origin.upload" },
  { key: "email", labelKey: "origin.email" },
  { key: "phone", labelKey: "origin.phone" },
];

/**
 * A chave de tradução de uma origem gravada.
 *
 * `null` não é erro: é nota gravada antes de o sistema guardar isso (ver
 * 013_invoice_source.sql). Vale dizer "não registrada" em vez de chutar
 * "upload", senão o painel afirmaria que documentos antigos vieram de um
 * caminho que ninguém pode confirmar.
 */
export function originLabelKey(source: string | null | undefined): TKey {
  const found = ORIGINS.find((o) => o.key === source);
  return found ? found.labelKey : "origin.unknown";
}
