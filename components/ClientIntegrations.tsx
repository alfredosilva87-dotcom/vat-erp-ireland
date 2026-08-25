"use client";

import { useCallback, useEffect, useState } from "react";
import { useT, type TKey } from "@/lib/i18n";

/**
 * Que módulos se integram, neste cliente.
 *
 * Existe porque um escritório não trata todos os clientes da mesma maneira. O
 * que tem duas notas por mês pode não querer contas a pagar nenhuma — quer
 * lançar a nota e pagar quando pagar. Ligar tudo para toda a gente enche a
 * tela dele de títulos que ninguém vai baixar, e uma lista de pendências que
 * ninguém trata deixa de ser lida também nos clientes onde ela importa.
 *
 * Cada linha diz o que a chave FAZ, e não o nome interno dela: "a nota de
 * compra vira conta a pagar" é o que a pessoa está a decidir. O nome da coluna
 * não ajuda ninguém a escolher.
 */

type Integracoes = {
  purchases_to_payable: boolean;
  sales_to_receivable: boolean;
  documents_to_accounting: boolean;
  hr_to_payable: boolean;
  bank_settles_titles: boolean;
};

/*
 * Cada linha diz o que a chave FAZ, e não o nome interno dela. O texto vive no
 * dicionário: `integ.<chave>` é o rótulo e `integ.<chave>_help` a explicação,
 * então acrescentar uma integração é acrescentar uma linha aqui e duas chaves.
 */
const LINHAS: { k: keyof Integracoes; tk: string }[] = [
  { k: "purchases_to_payable", tk: "purchasesToPayable" },
  { k: "sales_to_receivable", tk: "salesToReceivable" },
  { k: "documents_to_accounting", tk: "documentsToAccounting" },
  { k: "hr_to_payable", tk: "hrToPayable" },
  { k: "bank_settles_titles", tk: "bankSettles" },
];

export default function ClientIntegrations({ clientId }: { clientId: string }) {
  const { t } = useT();
  const [v, setV] = useState<Integracoes | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/clients/${clientId}/integrations`, { cache: "no-store" });
    if (r.ok) setV(await r.json());
  }, [clientId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function alternar(k: keyof Integracoes) {
    if (!v) return;
    const proximo = !v[k];
    // Otimista: a caixa responde ao clique e volta atrás se o servidor recusar.
    // Uma caixa que só mexe depois da resposta faz a pessoa clicar duas vezes.
    setV({ ...v, [k]: proximo });
    setGravando(k);
    setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/integrations`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [k]: proximo }),
      });
      if (!r.ok) throw new Error((await r.json()).error || t("integ.saveFailed"));
      setV(await r.json());
    } catch (e: any) {
      setV({ ...v, [k]: !proximo });
      setErro(e.message);
    } finally {
      setGravando(null);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-lg font-semibold">{t("integ.title")}</h2>
      <p className="text-sm text-muted">{t("integ.subtitle")}</p>

      {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}

      <div className="mt-4 divide-y divide-line">
        {LINHAS.map((l) => (
          <label key={l.k} className="flex cursor-pointer items-start gap-3 py-3">
            <input
              type="checkbox" className="mt-0.5 shrink-0 accent-brand"
              checked={v ? v[l.k] : true}
              disabled={!v || gravando === l.k}
              onChange={() => alternar(l.k)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t(`integ.${l.tk}` as TKey)}</span>
              <span className="block text-xs text-muted">{t(`integ.${l.tk}_help` as TKey)}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted">{t("integ.footer")}</p>
    </section>
  );
}
