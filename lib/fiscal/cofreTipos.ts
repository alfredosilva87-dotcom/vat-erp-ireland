/**
 * O vocabulário do cofre de documentos — sem banco e sem rede.
 *
 * Vive separado de `cofre.ts` porque a TELA precisa dele: `cofre.ts` é
 * `server-only` (fala com o armazenamento), e um componente de cliente que o
 * importasse rebentaria a build. Aqui ficam os tipos e a regra de validade,
 * que são os dois lados a partilhar.
 */

export const TIPOS_DE_DOCUMENTO = [
  { valor: "identity", rotulo: "Identidade", caduca: true },
  { valor: "address", rotulo: "Comprovativo de morada", caduca: true },
  { valor: "incorporation", rotulo: "Pacto social / constituição", caduca: false },
  { valor: "tax", rotulo: "Registo fiscal", caduca: false },
  { valor: "other", rotulo: "Outro", caduca: false },
] as const;

export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number]["valor"];

export type DocumentoDoCliente = {
  id: string;
  kind: string;
  title: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  issuedOn: string | null;
  expiresOn: string | null;
  notes: string | null;
  createdAt: string;
  /** Calculado, nunca gravado: caducado, a caducar em 60 dias, ou em ordem. */
  validade: "sem_prazo" | "valido" | "a_caducar" | "caducado";
  diasParaCaducar: number | null;
};

/** Onde ainda dá tempo de pedir o documento novo antes de o velho caducar. */
export const DIAS_AVISO_VALIDADE = 60;

const DIA = 86_400_000;

/**
 * A validade é SEMPRE calculada, e nunca uma coluna.
 *
 * Um estado gravado envelhece sozinho: o documento que era válido ontem é o
 * mesmo registo hoje, e o que muda é a data. Guardar "válido" faria o cofre
 * dizer que está tudo bem para sempre.
 */
export function validadeDe(
  expiresOn: string | null,
  hoje: string
): { validade: DocumentoDoCliente["validade"]; dias: number | null } {
  if (!expiresOn) return { validade: "sem_prazo", dias: null };
  const a = Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10));
  const b = Date.UTC(+expiresOn.slice(0, 4), +expiresOn.slice(5, 7) - 1, +expiresOn.slice(8, 10));
  const dias = Math.round((b - a) / DIA);
  if (dias < 0) return { validade: "caducado", dias };
  if (dias <= DIAS_AVISO_VALIDADE) return { validade: "a_caducar", dias };
  return { validade: "valido", dias };
}

/**
 * Os tipos de ficheiro que o cofre aceita, e que pode mostrar no navegador.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UMA LISTA FECHADA E NÃO "qualquer ficheiro"
 *
 * O cofre serve os ficheiros para dentro da própria aplicação. Um HTML enviado
 * como `text/html` seria RENDERIZADO na origem do ERP, com os cookies de sessão
 * de quem o abrisse ao alcance do script — e o atacante nem precisaria de
 * entrar: bastava que alguém com acesso ao cliente carregasse o ficheiro por
 * engano, ou que uma conta comprometida o deixasse lá à espera.
 *
 * Um comprovativo de morada é um PDF ou uma fotografia. Não há caso legítimo
 * para um ficheiro executável ou marcado neste cofre, e a lista fecha por isso.
 * ---------------------------------------------------------------------------
 *
 * O `accept` do <input> não conta como defesa: é uma sugestão ao seletor de
 * ficheiros do navegador, e qualquer pedido feito à mão o ignora. A guarda tem
 * de estar no servidor.
 */
export const MIMES_ACEITES: readonly string[] = [
  "application/pdf",
  "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
];

export function mimeAceite(mime: string | null | undefined): boolean {
  // O navegador manda `image/jpeg; charset=...` às vezes; conta o tipo, não o resto.
  const limpo = (mime ?? "").split(";")[0].trim().toLowerCase();
  return MIMES_ACEITES.includes(limpo);
}
