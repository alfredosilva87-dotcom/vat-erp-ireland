"use client";

/**
 * O QUE O UTILIZADOR VÊ QUANDO A TRAVA MORDE.
 *
 * A recusa vem do servidor com a CONTAGEM (ver lib/cadastros/vinculos.ts), e é
 * essa contagem que faz a diferença entre uma parede e uma explicação:
 *
 *   "Não foi possível apagar"            ← o que havia
 *   "5 notas de compra, 12 lançamentos   ← o que passa a haver
 *    no razão, 3 meses fechados"
 *
 * A segunda versão responde sozinha à pergunta seguinte — *e agora?* — porque
 * quem lê percebe imediatamente que aquilo não é lixo, é histórico.
 *
 * O botão de desactivar vive AQUI, dentro do próprio aviso, e não numa parte
 * distante do ecrã. A trava e a saída têm de estar no mesmo sítio: quem acaba
 * de bater na parede não vai procurar a porta noutra tela.
 */

import { useT, type TKey } from "@/lib/i18n";

export interface Impedimento {
  error: "temMovimento";
  total: number;
  vinculos: { chave: string; quantidade: number }[];
}

/** O servidor recusou por movimento? Distinguir isto de um erro qualquer. */
export function ehImpedimento(x: any): x is Impedimento {
  return Boolean(x) && x.error === "temMovimento" && Array.isArray(x.vinculos);
}

export default function TravaDeExclusao({
  impedimento, onDesactivar, aDesactivar,
}: {
  impedimento: Impedimento;
  /** Ausente quando este cadastro ainda não tem onde ser desactivado. */
  onDesactivar?: () => void;
  aDesactivar?: boolean;
}) {
  const { t } = useT();
  // Três chegam. Uma lista de onze deixa de ser lida, e os três maiores já
  // dizem o tamanho — a mesma decisão está em resumoDoImpedimento().
  const principais = impedimento.vinculos.slice(0, 3);
  const restantes = impedimento.vinculos.length - principais.length;

  return (
    <div className="rounded-xl border border-danger/40 bg-danger-50 px-4 py-3 text-sm">
      <p className="font-medium text-danger">{t("trava.title")}</p>
      <p className="mt-1">{t("trava.body", { n: String(impedimento.total) })}</p>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] text-muted">
        {principais.map((v) => (
          <li key={v.chave}>
            <strong className="tnum">{v.quantidade}</strong> {t(v.chave as TKey)}
          </li>
        ))}
        {restantes > 0 && <li>{t("trava.more", { n: String(restantes) })}</li>}
      </ul>
      <p className="mt-2 text-muted">{t("trava.what")}</p>
      {onDesactivar && (
        <button className="btn-ghost mt-2 h-8 px-3 text-xs" onClick={onDesactivar} disabled={aDesactivar}>
          {aDesactivar ? t("common.saving") : t("trava.deactivate")}
        </button>
      )}
    </div>
  );
}

/**
 * O aviso do outro lado: escolheu-se um cadastro desactivado.
 *
 * Não impede — avisa. Quem abre um cliente desactivado para consultar o
 * histórico tem todo o direito de o fazer; o que não pode é lançar nele sem
 * dar por isso.
 */
export function AvisoDesactivado() {
  const { t } = useT();
  return (
    <div className="rounded-xl border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
      {t("trava.inactiveChosen")}
    </div>
  );
}
