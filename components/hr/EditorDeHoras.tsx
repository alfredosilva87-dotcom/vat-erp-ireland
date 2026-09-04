"use client";

import { useEffect, useState } from "react";
import { useT, type TKey } from "@/lib/i18n";
import { grossDetail, isHourly, type Employee } from "@/lib/hr/payroll";
import type { ConfigDaEmpresa } from "@/lib/hr/regrasDaEmpresa";

/**
 * LANÇAR AS HORAS DE UMA SEMANA — o ecrã que não existia.
 *
 * ---------------------------------------------------------------------------
 * O BURACO
 *
 * O quadro "Time worked" mostrava as horas e não aceitava uma tecla. As horas
 * só entravam por duas portas: um CSV, e a fila do que o cliente manda. Corrigir
 * um engano numa semana já lançada não tinha caminho nenhum pelo produto.
 *
 * É a terceira vez que este sistema tropeça na mesma coisa — o funcionário que
 * só se criava por SQL, a compra que só entrava pela leitura automática, e agora
 * isto. A pergunta que a evita é sempre a mesma: *o que cria a primeira linha
 * desta tabela?* Se a resposta não for um ecrã, falta um ecrã.
 *
 * ---------------------------------------------------------------------------
 * A MEMÓRIA DE CÁLCULO AO LADO DOS CAMPOS, E NÃO NUM RELATÓRIO
 *
 * O bruto aparece enquanto se escreve, partido em parcelas: "32h × 13,00 +
 * 8h × 26,00". É esse detalhe que apanha a taxa errada — um total sozinho é
 * plausível de mais para se contestar.
 *
 * E é por isso que a taxa se corrige AQUI. Descobre-se o erro a olhar para o
 * bruto de uma semana; mandar a pessoa à ficha do funcionário, noutro
 * separador, para voltar depois, é onde a correcção se perde.
 */

type Linha = {
  hours?: number | string | null;
  sunday_hours?: number | string | null;
  holiday_hours?: number | string | null;
  week_worked?: boolean | null;
  gross_override?: number | string | null;
};

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default function EditorDeHoras({
  clientId, employee, nome, year, week, linha, config, aoGravar, aoFechar,
}: {
  clientId: string;
  employee: Employee & Record<string, any>;
  nome: string;
  year: number;
  week: number;
  linha: Linha | null;
  config: ConfigDaEmpresa | null;
  aoGravar: () => void;
  aoFechar: () => void;
}) {
  const { t } = useT();
  const [f, setF] = useState({
    hours: txt(linha?.hours),
    sunday_hours: txt(linha?.sunday_hours),
    holiday_hours: txt(linha?.holiday_hours),
    week_worked: linha?.week_worked ?? false,
    gross_override: txt(linha?.gross_override),
  });
  const [taxas, setTaxas] = useState({
    hourly_rate: txt(employee.hourly_rate),
    sunday_rate: txt(employee.sunday_rate),
  });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Mudar de célula sem fechar o painel tem de trocar o conteúdo. Sem isto, o
  // painel ficava a mostrar a semana anterior com os campos da nova.
  useEffect(() => {
    setF({
      hours: txt(linha?.hours),
      sunday_hours: txt(linha?.sunday_hours),
      holiday_hours: txt(linha?.holiday_hours),
      week_worked: linha?.week_worked ?? false,
      gross_override: txt(linha?.gross_override),
    });
    setTaxas({ hourly_rate: txt(employee.hourly_rate), sunday_rate: txt(employee.sunday_rate) });
    setErro(null);
  }, [employee, linha, week]);

  const aoHora = isHourly(employee);

  /*
   * A conta que se mostra é a MESMA que a folha corre.
   *
   * `grossDetail` é a função que o cálculo usa; repetir a multiplicação aqui
   * daria um número que concorda com o ecrã e discorda do recibo — e um erro
   * assim parece conferido, que é a pior maneira de errar.
   */
  const conta = grossDetail(
    { ...employee, hourly_rate: taxas.hourly_rate || 0, sunday_rate: taxas.sunday_rate || null },
    {
      hours: f.hours === "" ? null : Number(f.hours),
      sunday_hours: f.sunday_hours === "" ? null : Number(f.sunday_hours),
      holiday_hours: f.holiday_hours === "" ? null : Number(f.holiday_hours),
      week_worked: f.week_worked,
      gross_override: f.gross_override === "" ? null : Number(f.gross_override),
    },
    config
  );

  const eur = (v: number) =>
    "€" + v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n2 = (v: number) => v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const taxaMudou =
    txt(employee.hourly_rate) !== taxas.hourly_rate || txt(employee.sunday_rate) !== taxas.sunday_rate;

  async function gravar() {
    setOcupado(true); setErro(null);
    try {
      /*
       * A TAXA PRIMEIRO, e as horas só se ela passar.
       *
       * Ao contrário, umas horas gravadas contra a taxa antiga ficavam a valer
       * um bruto que ninguém pediu — e o ecrã mostrava o novo. Falhando a taxa,
       * pára-se aqui e diz-se.
       */
      if (taxaMudou) {
        const r = await fetch(`/api/hr/companies/${clientId}/employees/${employee.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...employee,
            hourly_rate: taxas.hourly_rate === "" ? null : Number(taxas.hourly_rate),
            sunday_rate: taxas.sunday_rate === "" ? null : Number(taxas.sunday_rate),
          }),
        });
        if (!r.ok) { setErro((await r.json().catch(() => ({}))).error || t("horas.falhouTaxa")); return; }
      }

      const r = await fetch(`/api/hr/companies/${clientId}/hours`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: employee.id, year, weekNo: week,
          hours: f.hours === "" ? null : Number(f.hours),
          sundayHours: f.sunday_hours === "" ? null : Number(f.sunday_hours),
          holidayHours: f.holiday_hours === "" ? null : Number(f.holiday_hours),
          weekWorked: f.week_worked,
          grossOverride: f.gross_override === "" ? null : Number(f.gross_override),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || t("horas.falhou")); return; }
      aoGravar();
    } catch {
      setErro(t("horas.falhou"));
    } finally { setOcupado(false); }
  }

  /**
   * APAGAR NÃO É PÔR ZERO.
   *
   * Zero é uma afirmação — "esta pessoa trabalhou zero horas nesta semana".
   * Apagar é "não há registo desta semana". A folha lê os dois de maneira
   * diferente, e o quadro mostra `—` num e `0` no outro.
   */
  async function apagar() {
    if (!window.confirm(t("horas.confirmarApagar", { semana: String(week) }))) return;
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(
        `/api/hr/companies/${clientId}/hours?employeeId=${employee.id}&year=${year}&weekNo=${week}`,
        { method: "DELETE" }
      );
      if (!r.ok) { setErro((await r.json().catch(() => ({}))).error || t("horas.falhou")); return; }
      aoGravar();
    } finally { setOcupado(false); }
  }

  const campo = "input h-9 w-24 text-[13px]";
  const rotulo = "text-[10px] font-medium uppercase tracking-wide text-muted";

  return (
    <div className="border-t border-line bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-[15px] font-semibold">
          {nome} · {t("hr.weekShort")}{week} / {year}
        </h3>
        <button className="text-[12px] underline" onClick={aoFechar}>{t("common.close")}</button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {aoHora ? (
          <>
            <label className="flex flex-col leading-tight">
              <span className={rotulo}>{t("horas.normais")}</span>
              <input className={`${campo} mt-1`} type="number" min="0" max="168" step="0.25"
                value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} autoFocus />
            </label>
            <label className="flex flex-col leading-tight">
              <span className={rotulo}>{t("horas.domingo")}</span>
              <input className={`${campo} mt-1`} type="number" min="0" max="168" step="0.25"
                value={f.sunday_hours} onChange={(e) => setF({ ...f, sunday_hours: e.target.value })} />
            </label>
            <label className="flex flex-col leading-tight">
              <span className={rotulo}>{t("horas.feriado")}</span>
              <input className={`${campo} mt-1`} type="number" min="0" max="168" step="0.25"
                value={f.holiday_hours} onChange={(e) => setF({ ...f, holiday_hours: e.target.value })} />
            </label>
          </>
        ) : (
          /*
            Contrato fixo não tem horas: tem uma semana marcada ou não marcada.
            Pedir horas a quem é pago ao mês produzia um número que não entra em
            conta nenhuma e que depois alguém tentava explicar.
          */
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-[13px]">
            <input type="checkbox" className="h-4 w-4 cursor-pointer" checked={!!f.week_worked}
              onChange={(e) => setF({ ...f, week_worked: e.target.checked })} />
            {t("horas.semanaTrabalhada")}
          </label>
        )}

        <label className="flex flex-col leading-tight">
          <span className={rotulo}>{t("horas.valorForcado")}</span>
          <input className={`${campo} mt-1`} type="number" min="0" step="0.01"
            placeholder="—"
            value={f.gross_override} onChange={(e) => setF({ ...f, gross_override: e.target.value })} />
        </label>
      </div>

      {/* ------------------------------------------- corrigir a taxa aqui */}
      {aoHora && (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
          <div className="pb-1.5 text-[12px] text-muted">{t("horas.taxasAqui")}</div>
          <label className="flex flex-col leading-tight">
            <span className={rotulo}>{t("hr.colRate")}</span>
            <input className={`${campo} mt-1`} type="number" min="0" step="0.01"
              value={taxas.hourly_rate} onChange={(e) => setTaxas({ ...taxas, hourly_rate: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className={rotulo}>{t("hr.colSundayRate")}</span>
            <input className={`${campo} mt-1`} type="number" min="0" step="0.01"
              placeholder={conta.regras.origemDomingo === "empresa" ? n2(conta.regras.taxaDomingo) : "—"}
              value={taxas.sunday_rate} onChange={(e) => setTaxas({ ...taxas, sunday_rate: e.target.value })} />
          </label>
          {taxaMudou && (
            <p className="pb-1.5 text-[12px] text-warning">{t("horas.taxaMudaTudo")}</p>
          )}
        </div>
      )}

      {/* ------------------------------------------- a memória de cálculo */}
      <div className="mt-3 rounded-xl border border-line bg-surface p-3">
        <p className={rotulo}>{t("horas.memoria")}</p>
        {conta.parcelas.length ? (
          <table className="mt-2 text-[13px]">
            <tbody>
              {conta.parcelas.map((p, i) => (
                <tr key={i}>
                  <td className="py-0.5 pr-4">{t(p.chave as TKey)}</td>
                  <td className="py-0.5 pr-2 text-right font-mono tabular-nums">{n2(p.horas)} h</td>
                  <td className="py-0.5 pr-2 text-muted">×</td>
                  <td className="py-0.5 pr-4 text-right font-mono tabular-nums">{eur(p.taxa)}</td>
                  <td className="py-0.5 text-right font-mono tabular-nums">{eur(p.valor)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="py-1 pr-4">{t("horas.bruto")}</td>
                <td colSpan={3} />
                <td className="py-1 text-right font-mono tabular-nums">{eur(conta.total)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="mt-1 font-mono text-[15px] font-semibold tabular-nums">{eur(conta.total)}</p>
        )}

        {/* De onde veio a taxa de domingo. Sem isto, "porque é que este domingo
            pagou isto?" não tem resposta a olhar. */}
        {aoHora && Number(f.sunday_hours || 0) > 0 && (
          <p className="mt-2 text-[12px] text-muted">
            {t(("horas.origem_" + conta.regras.origemDomingo) as TKey)}
          </p>
        )}
        {!!conta.avisos.length && (
          <ul className="mt-2 space-y-0.5 text-[12px] text-warning">
            {conta.avisos.map((a, i) => <li key={i}>· {t(a as TKey)}</li>)}
          </ul>
        )}
      </div>

      {erro && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn-primary h-9 px-4 text-sm" disabled={ocupado} onClick={gravar}>
          {ocupado ? "…" : t("common.save")}
        </button>
        {linha && (
          <button className="btn-ghost h-9 px-4 text-sm text-danger" disabled={ocupado} onClick={apagar}>
            {t("horas.apagar")}
          </button>
        )}
        <p className="text-[12px] text-muted">{t("horas.apagarNota")}</p>
      </div>
    </div>
  );
}
