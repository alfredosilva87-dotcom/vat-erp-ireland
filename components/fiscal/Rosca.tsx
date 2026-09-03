"use client";

import { useT } from "@/lib/i18n";
"use client";

/**
 * A rosca (donut) dos indicadores da agenda.
 *
 * ---------------------------------------------------------------------------
 * POR QUE UMA ROSCA E NÃO SÓ O NÚMERO
 *
 * "4 clientes com atraso" não diz nada sozinho — 4 em 5 é uma crise, 4 em 200
 * é uma terça-feira. O número era o que estava lá, e obrigava quem lê a ir
 * buscar o total a outro cartão e a fazer a divisão de cabeça.
 *
 * A rosca põe a proporção e o número no mesmo sítio: vê-se o quanto antes de
 * se ler o quanto.
 * ---------------------------------------------------------------------------
 *
 * Sem biblioteca de gráficos: é um SVG com dois círculos e um `stroke-dasharray`.
 * Arrastar um Chart.js para desenhar isto pesaria mais do que a página inteira.
 *
 * As cores vêm das variáveis de `globals.css` e nunca de hex literal — senão o
 * gráfico não acompanha o tema escuro nem uma mudança de paleta.
 */

export type TomDaRosca = "brand" | "danger" | "warning" | "success";

const TRACO: Record<TomDaRosca, string> = {
  brand: "rgb(var(--c-brand))",
  danger: "rgb(var(--c-danger))",
  warning: "rgb(var(--c-warning))",
  success: "rgb(var(--c-success))",
};

export default function Rosca({
  valor, total, rotulo, nota, tom = "brand",
}: {
  valor: number;
  /** Zero é um caso legítimo — ver abaixo. */
  total: number;
  rotulo: string;
  nota?: string;
  tom?: TomDaRosca;
}) {
  const { t } = useT();
  const R = 26;
  const CIRC = 2 * Math.PI * R;

  /*
   * Total zero desenha o anel VAZIO, e não cheio nem partido.
   *
   * `valor / 0` é `NaN`, e um `NaN` num `stroke-dasharray` faz o SVG desenhar o
   * traço inteiro — ou seja, um escritório sem clientes nenhuns apareceria com
   * o anel a 100%. É o caso do primeiro dia de uso, e é justamente quando não
   * se deve mostrar um número que assusta.
   */
  const fracao = total > 0 ? Math.min(1, Math.max(0, valor / total)) : 0;
  const percentagem = Math.round(fracao * 100);

  return (
    <div className="card flex items-center gap-4 p-4">
      <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0" aria-hidden="true">
        <circle cx="34" cy="34" r={R} fill="none" strokeWidth="9"
          stroke="rgb(var(--c-line))" />
        <circle
          cx="34" cy="34" r={R} fill="none" strokeWidth="9" strokeLinecap="round"
          stroke={TRACO[tom]}
          strokeDasharray={`${CIRC * fracao} ${CIRC}`}
          // Começa às 12 horas, e não às 3: é onde o olho espera que um
          // indicador circular comece.
          transform="rotate(-90 34 34)"
        />
        <text x="34" y="38" textAnchor="middle"
          className="fill-ink font-semibold" style={{ fontSize: 15 }}>
          {valor}
        </text>
      </svg>

      <div className="min-w-0">
        <div className="text-[10.5px] uppercase tracking-wide text-muted">{rotulo}</div>
        <div className="mt-0.5 text-sm">
          {/*
            * O denominador vai à vista.
            *
            * É ele que dá sentido ao numerador, e escondê-lo atrás de uma
            * percentagem faria perder a escala — "80%" de dois clientes e de
            * duzentos lêem-se igual e não são a mesma coisa.
            */}
          <span className="font-display text-lg font-semibold">{valor}</span>
          <span className="text-muted"> {t("agenda.of")} {total}</span>
          {total > 0 && <span className="ml-2 text-xs text-muted">({percentagem}%)</span>}
        </div>
        {nota && <div className="mt-0.5 truncate text-[11px] text-muted">{nota}</div>}
      </div>
    </div>
  );
}
