"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { LEI, regrasPara } from "@/lib/hr/regrasDaEmpresa";

/**
 * AS REGRAS DE PAGAMENTO DESTA EMPRESA.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ISTO É UM ECRÃ E NÃO UM CAMPO NA FICHA DE CADA UM
 *
 * "Aqui o domingo paga-se a dobrar" é uma frase sobre a EMPRESA. Enquanto viveu
 * num campo por funcionário, tinha de ser repetida em cada ficha — e esquecida
 * numa delas passava despercebida até alguém contestar um recibo, porque o
 * sistema pagava o domingo ao preço de terça-feira sem dizer nada.
 *
 * O campo por funcionário continua a existir e continua a ganhar: há sempre o
 * contrato individual diferente do resto da casa. O que muda é o que acontece
 * quando ele está vazio.
 *
 * ---------------------------------------------------------------------------
 * A CONTA APARECE ENQUANTO SE ESCREVE
 *
 * Um multiplicador é abstracto; "13,00 → 26,00 por hora" não é. O exemplo em
 * baixo usa uma taxa real desta empresa, e é ele que apanha o 20 escrito onde
 * devia estar o 2.
 */

type Cfg = {
  sunday_mode?: string | null;
  sunday_multiplier?: number | string | null;
  overtime_after_hours?: number | string | null;
  overtime_multiplier?: number | string | null;
  holiday_accrual_pct?: number | string | null;
  holiday_days_year?: number | string | null;
};

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default function RegrasDaEmpresa({
  clientId, config, taxaExemplo, aoGravar,
}: {
  clientId: string;
  config: Cfg | null;
  /** Uma taxa hora real desta empresa, para o exemplo não ser inventado. */
  taxaExemplo: number;
  aoGravar: () => void;
}) {
  const { t } = useT();
  const [f, setF] = useState({
    sunday_mode: config?.sunday_mode ?? "rate",
    sunday_multiplier: txt(config?.sunday_multiplier),
    overtime_after_hours: txt(config?.overtime_after_hours),
    overtime_multiplier: txt(config?.overtime_multiplier),
    holiday_accrual_pct: txt(config?.holiday_accrual_pct ?? LEI.feriasPct),
    holiday_days_year: txt(config?.holiday_days_year ?? LEI.feriasDias),
  });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);

  // A configuração pode chegar depois do primeiro desenho (a página carrega
  // em duas etapas); sem isto o formulário ficava com os padrões à frente dos
  // valores gravados.
  useEffect(() => {
    if (!config) return;
    setF({
      sunday_mode: config.sunday_mode ?? "rate",
      sunday_multiplier: txt(config.sunday_multiplier),
      overtime_after_hours: txt(config.overtime_after_hours),
      overtime_multiplier: txt(config.overtime_multiplier),
      holiday_accrual_pct: txt(config.holiday_accrual_pct ?? LEI.feriasPct),
      holiday_days_year: txt(config.holiday_days_year ?? LEI.feriasDias),
    });
  }, [config]);

  const taxa = taxaExemplo > 0 ? taxaExemplo : 13;
  /*
   * A PRÉ-VISUALIZAÇÃO PASSA PELO MESMO MOTOR QUE A FOLHA.
   *
   * Recalcular aqui "à mão" daria um exemplo que concorda com o ecrã e discorda
   * do recibo — que é a pior maneira de errar, porque parece conferido.
   */
  const previa = regrasPara(
    {
      sunday_mode: f.sunday_mode,
      sunday_multiplier: f.sunday_multiplier || null,
      overtime_after_hours: f.overtime_after_hours || null,
      overtime_multiplier: f.overtime_multiplier || null,
      holiday_accrual_pct: f.holiday_accrual_pct || null,
      holiday_days_year: f.holiday_days_year || null,
    },
    { hourly_rate: taxa }
  );

  const eur = (v: number) =>
    "€" + v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const abaixoDaLei =
    Number(f.holiday_accrual_pct || 0) < LEI.feriasPct ||
    Number(f.holiday_days_year || 0) < LEI.feriasDias;

  async function gravar() {
    setOcupado(true); setErro(null); setRecado(null);
    try {
      const r = await fetch(`/api/hr/companies/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sunday_mode: f.sunday_mode,
          // Vazio grava NULO, que quer dizer "não há regra" — e não zero, que
          // seria uma regra a mandar não pagar nada.
          sunday_multiplier: f.sunday_multiplier === "" ? null : Number(f.sunday_multiplier),
          overtime_after_hours: f.overtime_after_hours === "" ? null : Number(f.overtime_after_hours),
          overtime_multiplier: f.overtime_multiplier === "" ? null : Number(f.overtime_multiplier),
          holiday_accrual_pct: Number(f.holiday_accrual_pct || LEI.feriasPct),
          holiday_days_year: Number(f.holiday_days_year || LEI.feriasDias),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || t("regras.falhou")); return; }
      setRecado(t("regras.gravado"));
      aoGravar();
    } catch {
      setErro(t("regras.falhou"));
    } finally { setOcupado(false); }
  }

  const campo = "input h-9 w-28 text-[13px]";
  const rotulo = "text-[10px] font-medium uppercase tracking-wide text-muted";

  return (
    <div className="space-y-6 p-4">
      <p className="max-w-3xl text-[12.5px] text-muted">{t("regras.ajuda")}</p>

      {/* ------------------------------------------------------- Domingo */}
      <section className="rounded-xl border border-line p-4">
        <h3 className="font-display text-[15px] font-semibold">{t("regras.domingo")}</h3>
        <div className="mt-3 space-y-2 text-[13px]">
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" className="mt-1" name="domingo" checked={f.sunday_mode === "rate"}
              onChange={() => setF({ ...f, sunday_mode: "rate" })} />
            <span>{t("regras.domingoRate")}</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2">
            <input type="radio" className="mt-1" name="domingo" checked={f.sunday_mode === "multiplier"}
              onChange={() => setF({ ...f, sunday_mode: "multiplier" })} />
            <span>{t("regras.domingoMult")}</span>
          </label>
        </div>

        {f.sunday_mode === "multiplier" && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col leading-tight">
              <span className={rotulo}>{t("regras.multiplicador")}</span>
              <input className={`${campo} mt-1`} type="number" min="1" max="10" step="0.25"
                value={f.sunday_multiplier}
                onChange={(e) => setF({ ...f, sunday_multiplier: e.target.value })} />
            </label>
            {/* Os atalhos que cobrem quase toda a gente. Escrever 1.5 à mão
                convida ao 15 que ninguém revê. */}
            <div className="flex gap-1 pb-1">
              {["1.5", "2"].map((v) => (
                <button key={v} type="button" className="btn-ghost h-8 px-3 text-[12px]"
                  onClick={() => setF({ ...f, sunday_multiplier: v })}>
                  {v}×
                </button>
              ))}
            </div>
            <p className="pb-1.5 text-[12.5px] text-muted">
              {t("regras.exemplo", { taxa: eur(taxa), resultado: eur(previa.taxaDomingo) })}
            </p>
          </div>
        )}

        {previa.origemDomingo === "semPremio" && (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
            {t("regra.semPremioDomingo")}
          </p>
        )}
      </section>

      {/* -------------------------------------------------------- Extras */}
      <section className="rounded-xl border border-line p-4">
        <h3 className="font-display text-[15px] font-semibold">{t("regras.extras")}</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col leading-tight">
            <span className={rotulo}>{t("regras.extrasApartir")}</span>
            <input className={`${campo} mt-1`} type="number" min="0" max="168" step="0.5"
              value={f.overtime_after_hours}
              onChange={(e) => setF({ ...f, overtime_after_hours: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className={rotulo}>{t("regras.extrasMult")}</span>
            <input className={`${campo} mt-1`} type="number" min="1" max="10" step="0.25"
              value={f.overtime_multiplier}
              onChange={(e) => setF({ ...f, overtime_multiplier: e.target.value })} />
          </label>
          {previa.extrasAPartirDe !== null && (
            <p className="pb-1.5 text-[12.5px] text-muted">
              {t("regras.exemploExtras", {
                horas: String(previa.extrasAPartirDe),
                taxa: eur(previa.taxaExtra ?? 0),
              })}
            </p>
          )}
        </div>
        {previa.avisos.includes("regra.extrasIncompleta") && (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
            {t("regra.extrasIncompleta")}
          </p>
        )}
        {previa.extrasAPartirDe === null && !previa.avisos.includes("regra.extrasIncompleta") && (
          <p className="mt-3 text-[12.5px] text-muted">{t("regras.extrasSemRegra")}</p>
        )}
        {/* O domingo já é pago a prémio; contá-lo também para o limiar pagaria
            duas vezes o mesmo excesso. Dizê-lo aqui evita a pergunta. */}
        <p className="mt-2 text-[12px] text-muted">{t("regras.extrasSemDomingo")}</p>
      </section>

      {/* -------------------------------------------------------- Férias */}
      <section className="rounded-xl border border-line p-4">
        <h3 className="font-display text-[15px] font-semibold">{t("regras.ferias")}</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col leading-tight">
            <span className={rotulo}>{t("regras.feriasPct")}</span>
            <input className={`${campo} mt-1`} type="number" min="0" max="100" step="0.5"
              value={f.holiday_accrual_pct}
              onChange={(e) => setF({ ...f, holiday_accrual_pct: e.target.value })} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className={rotulo}>{t("regras.feriasDias")}</span>
            <input className={`${campo} mt-1`} type="number" min="0" max="365" step="1"
              value={f.holiday_days_year}
              onChange={(e) => setF({ ...f, holiday_days_year: e.target.value })} />
          </label>
          <p className="pb-1.5 text-[12.5px] text-muted">
            {t("regras.exemploFerias", {
              horas: "40",
              resultado: (40 * (Number(f.holiday_accrual_pct || 0) / 100)).toFixed(2),
            })}
          </p>
        </div>
        <p className="mt-2 text-[12px] text-muted">{t("regras.minimoLegal")}</p>
        {abaixoDaLei && (
          <p className="mt-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
            {t("regras.abaixoDaLei")}
          </p>
        )}
      </section>

      {erro && <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {recado && <p className="rounded-lg border border-ok/40 bg-success-50 px-3 py-2 text-sm">{recado}</p>}

      <button className="btn-primary h-9 px-4 text-sm" disabled={ocupado} onClick={gravar}>
        {ocupado ? "…" : t("regras.gravar")}
      </button>
    </div>
  );
}
