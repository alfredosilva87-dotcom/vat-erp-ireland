"use client";

import { isoWeeksInYear, isoWeekStart } from "@/lib/hr/payroll";
import { hrYearOptions } from "@/components/hr/useHrYear";
import { useT } from "@/lib/i18n";

/**
 * Ano e semana — os controlos que o RH tem de seu.
 *
 * O ano fica AQUI e não na barra do topo porque o RH é independente do
 * exercício fiscal enquanto a integração com o sistema do Matheus não for
 * desenhada. Ver components/hr/useHrYear.ts.
 *
 * A semana mostra o intervalo de datas junto do número: "semana 34" não diz
 * nada a ninguém sem um calendário à frente, e a pergunta que se faz é sempre
 * "aquela semana de agosto".
 */
export default function WeekPicker({
  year,
  week,
  onWeek,
  onYear,
}: {
  year: number;
  week: number;
  onWeek: (w: number) => void;
  /** Sem isto o seletor de ano não aparece — telas que não dependem da semana. */
  onYear?: (y: number) => void;
}) {
  const { t } = useT();
  const total = isoWeeksInYear(year);

  const intervalo = (w: number) => {
    const a = isoWeekStart(year, w);
    const b = new Date(a);
    b.setUTCDate(b.getUTCDate() + 6);
    const f = (d: Date) =>
      `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return `${f(a)} – ${f(b)}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {onYear && (
        <label className="mr-1 flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">
            {t("hr.yearLabel")}
          </span>
          <select
            className="input h-8 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={year}
            onChange={(e) => {
              const y = Number(e.target.value);
              onYear(y);
              // Semana 53 num ano de 52 deixaria a tela num período que não
              // existe — ver o comentário em isoWeeksInYear.
              const max = isoWeeksInYear(y);
              if (week > max) onWeek(max);
            }}
            aria-label={t("hr.yearLabel")}
          >
            {hrYearOptions().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      )}

      <button
        className="btn-ghost h-9 px-2.5"
        onClick={() => onWeek(Math.max(1, week - 1))}
        disabled={week <= 1}
        aria-label={t("hr.prevWeek")}
      >
        ‹
      </button>
      <select
        className="input h-9 w-auto min-w-[13rem] cursor-pointer py-0"
        value={week}
        onChange={(e) => onWeek(Number(e.target.value))}
        aria-label={t("hr.week")}
      >
        {Array.from({ length: total }, (_, i) => i + 1).map((w) => (
          <option key={w} value={w}>
            {t("hr.week")} {w} · {intervalo(w)}
          </option>
        ))}
      </select>
      <button
        className="btn-ghost h-9 px-2.5"
        onClick={() => onWeek(Math.min(total, week + 1))}
        disabled={week >= total}
        aria-label={t("hr.nextWeek")}
      >
        ›
      </button>
    </div>
  );
}
