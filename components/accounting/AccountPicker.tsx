"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * Quais contas entram no razão — no ecrã e no ficheiro.
 *
 * É uma escolha só, de propósito. Ver dez contas e imprimir cinquenta é o
 * erro que faz alguém levar a folha errada para a reunião de conciliação; e
 * duas seleções separadas (uma para ver, outra para imprimir) seriam duas
 * coisas para manter em sintonia à mão.
 *
 * `null` quer dizer TODAS — e não "nenhuma". Um cliente novo, ainda sem
 * seleção guardada, deve ver o razão inteiro e não um ecrã vazio que parece
 * um erro.
 */

export type ContaDisponivel = {
  code: string; name: string; entries: number; movement: number;
};

export default function AccountPicker({
  available, selected, onChange,
}: {
  available: ContaDisponivel[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const { t } = useT();
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return available;
    return available.filter((c) =>
      c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
  }, [available, busca]);

  const todas = selected === null;
  const escolhida = (code: string) => todas || selected!.includes(code);
  const quantas = todas ? available.length : selected!.length;

  function alternar(code: string) {
    // A primeira desmarcação parte de "todas": sem isto, desmarcar uma conta
    // quando tudo está selecionado não teria efeito visível nenhum.
    const base = todas ? available.map((c) => c.code) : selected!;
    const proxima = base.includes(code)
      ? base.filter((c) => c !== code)
      : [...base, code];
    onChange(proxima.length === available.length ? null : proxima);
  }

  const eur = (v: number) =>
    v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-sm font-semibold">{t("ledger.accounts")}</h2>
          <span className="chip bg-surface-2 text-[11px] text-muted">
            {t("ledger.selected", { n: quantas, total: available.length })}
          </span>
        </div>
        <input
          className="input mt-2 h-8 w-full text-[13px]"
          placeholder={t("ledger.searchAccounts")}
          value={busca} onChange={(e) => setBusca(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-ghost h-7 px-2 text-[11px]" onClick={() => onChange(null)}>
            {t("ledger.selectAll")}
          </button>
          <button className="btn-ghost h-7 px-2 text-[11px]" onClick={() => onChange([])}>
            {t("ledger.selectNone")}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtradas.map((c) => (
          <label key={c.code}
            className="flex cursor-pointer items-center gap-2 border-b border-line/60 px-4 py-2 text-[13px] transition-colors hover:bg-surface-2/60">
            <input type="checkbox" className="shrink-0 accent-brand"
              checked={escolhida(c.code)} onChange={() => alternar(c.code)} />
            <span className="w-11 shrink-0 font-mono text-[11px] text-muted">{c.code}</span>
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted"
              title={t("ledger.movementOf", { n: c.entries })}>
              {eur(c.movement)}
            </span>
          </label>
        ))}
        {filtradas.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted">{t("ledger.noAccounts")}</p>
        )}
      </div>
    </div>
  );
}
