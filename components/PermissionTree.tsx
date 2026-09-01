"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { PERM_TREE, ALL_PERM_IDS } from "@/lib/permissions";

/**
 * A árvore de permissões: grupo (módulo) em cima, tela embaixo.
 *
 * O pai não é um dado — é derivado dos filhos. Marcar o grupo marca as telas
 * dele, e o estado do grupo se lê das telas: cheio, vazio, ou o traço do
 * parcial. Guardar "módulo liberado" separado das telas cria a contradição
 * clássica ("o módulo está marcado mas nenhuma tela aparece") e alguém sempre
 * a encontra depois, na frente do cliente.
 *
 * `value === null` = sem restrição. É diferente de "tudo marcado" só na hora de
 * gravar (ver toIds), e igual na tela — de propósito: quem abre isto quer ver
 * o que o usuário alcança, não o formato do dado.
 */
export default function PermissionTree({
  value,
  onChange,
  disabled = false,
}: {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const selected = new Set(value ?? ALL_PERM_IDS);
  const emit = (s: Set<string>) => {
    const ids = ALL_PERM_IDS.filter((id) => s.has(id));
    // Tudo marcado volta a ser `null` (sem restrição) em vez da lista inteira:
    // assim uma tela NOVA do sistema nasce visível para quem nunca foi
    // restringido, em vez de nascer escondida para todo mundo.
    onChange(ids.length === ALL_PERM_IDS.length ? null : ids);
  };

  function toggleScreen(id: string) {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    emit(s);
  }

  function toggleGroup(groupId: string) {
    const g = PERM_TREE.find((x) => x.id === groupId);
    if (!g) return;
    const all = g.screens.every((sc) => selected.has(sc.id));
    const s = new Set(selected);
    for (const sc of g.screens) all ? s.delete(sc.id) : s.add(sc.id);
    emit(s);
  }

  const total = ALL_PERM_IDS.length;
  const count = ALL_PERM_IDS.filter((id) => selected.has(id)).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <p className="text-sm text-muted">
          {count === total
            ? t("perm.countAll")
            : t("perm.count", { n: count, total })}
        </p>
        <div className="flex flex-wrap gap-1">
          <button className="btn-ghost h-8 px-3 text-xs" disabled={disabled}
            onClick={() => onChange(null)}>
            {t("perm.selectAll")}
          </button>
          <button className="btn-ghost h-8 px-3 text-xs" disabled={disabled}
            onClick={() => emit(new Set())}>
            {t("perm.selectNone")}
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line">
        {PERM_TREE.map((g, gi) => {
          const on = g.screens.filter((sc) => selected.has(sc.id)).length;
          const all = on === g.screens.length;
          const some = on > 0 && !all;
          const open = !collapsed[g.id];
          return (
            <div key={g.id} className={gi ? "border-t border-line" : ""}>
              <div className="flex items-center gap-2 bg-surface-2/60 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g.id]: open }))}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:text-ink"
                  aria-label={t(open ? "perm.collapse" : "perm.expand")}
                  aria-expanded={open}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d={open ? "m6 9 6 6 6-6" : "m9 6 6 6-6 6"}
                      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <Box checked={all} indeterminate={some} disabled={disabled}
                  onChange={() => toggleGroup(g.id)} />
                <span className="flex-1 text-sm font-semibold">{t(g.labelKey)}</span>
                {g.scope === "client" && (
                  <span className="chip bg-surface text-[10px] uppercase tracking-wide text-muted">
                    {t("perm.scopeClient")}
                  </span>
                )}
                <span className="w-12 text-right font-mono text-xs tabular-nums text-muted">
                  {on}/{g.screens.length}
                </span>
              </div>

              {open && (
                <ul>
                  {g.screens.map((sc) => (
                    <li key={sc.id}
                      className="flex items-center gap-2 border-t border-line/60 px-3 py-1.5 hover:bg-surface-2/40">
                      <span className="w-5 shrink-0" />
                      <span className="w-3 shrink-0 border-l border-line" />
                      <Box checked={selected.has(sc.id)} disabled={disabled}
                        onChange={() => toggleScreen(sc.id)} />
                      <span className="flex-1 text-sm">{t(sc.labelKey)}</span>
                      <span className="font-mono text-[11px] text-muted">{sc.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Caixa com o terceiro estado — o traço que diz "parte do módulo". */
function Box({
  checked, indeterminate = false, disabled, onChange,
}: {
  checked: boolean; indeterminate?: boolean; disabled?: boolean; onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 shrink-0 accent-brand"
      checked={checked}
      disabled={disabled}
      // `indeterminate` só existe na propriedade do DOM, não no atributo — sem
      // este ref a caixa do módulo parcial fica vazia e mente.
      ref={(el) => { if (el) el.indeterminate = indeterminate && !checked; }}
      onChange={onChange}
    />
  );
}
