"use client";

import { useCallback, useEffect, useState } from "react";

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

const LINHAS: { k: keyof Integracoes; titulo: string; ajuda: string }[] = [
  {
    k: "purchases_to_payable",
    titulo: "Nota de compra vira conta a pagar",
    ajuda: "Cada nota lançada abre um título com vencimento estimado em 30 dias.",
  },
  {
    k: "sales_to_receivable",
    titulo: "Venda vira conta a receber",
    ajuda: "Cada venda lançada abre um título a receber.",
  },
  {
    k: "documents_to_accounting",
    titulo: "Documentos geram lançamento contábil",
    ajuda: "Alimenta o razão, o balancete, o DRE e o balanço. Desligado, os títulos continuam a nascer — só não há partidas dobradas.",
  },
  {
    k: "hr_to_payable",
    titulo: "Folha de pagamento vira conta a pagar",
    ajuda: "O valor da folha entra como título, para casar com o pagamento no banco.",
  },
  {
    k: "bank_settles_titles",
    titulo: "Movimento do banco dá baixa nos títulos",
    ajuda: "Um pagamento identificado fecha o título correspondente sozinho.",
  },
];

export default function ClientIntegrations({ clientId }: { clientId: string }) {
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
      if (!r.ok) throw new Error((await r.json()).error || "Não gravou.");
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
      <h2 className="font-display text-lg font-semibold">Integrações</h2>
      <p className="text-sm text-muted">
        O que este cliente alimenta automaticamente. Desligue o que ele não usa — assim a tela
        dele não enche de pendências que ninguém vai tratar.
      </p>

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
              <span className="block text-sm font-medium">{l.titulo}</span>
              <span className="block text-xs text-muted">{l.ajuda}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-3 text-xs text-muted">
        Desligar não apaga o que já existe — só deixa de criar daqui para a frente.
      </p>
    </section>
  );
}
