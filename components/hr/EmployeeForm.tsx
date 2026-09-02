"use client";

import { useEffect, useState } from "react";
import { payTypesDe, type FreqType } from "@/lib/hr/funcionarioPuro";
import { useT, type TKey } from "@/lib/i18n";

/**
 * Criar e editar um funcionário — a tela que faltava.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM DOS BLOCOS É A ORDEM DA CONVERSA
 *
 * Quem admite alguém sabe primeiro o nome e quanto lhe vai pagar; os dados
 * fiscais chegam depois, com o PPS e o RPN. Pôr o imposto à cabeça fazia o
 * formulário parecer impossível de preencher no dia em que a pessoa entra.
 *
 * Por isso "Imposto" abre fechado: preenche-se o que se sabe, grava-se, e
 * volta-se quando o RPN chegar. A folha calcula na mesma — em base de
 * emergência, que é o que a lei manda enquanto não há RPN.
 */

type Emp = Record<string, any>;

/*
 * Os rotulos passam pelo dicionario, e nao sao texto cravado.
 *
 * Escrevi esta tela toda em portugues e ela ficou a destoar no meio de um ERP
 * que fala INGLES — que e exactamente a divida que ja estava na fila dele.
 * Corrigido antes de commitar: o par aqui e `valor guardado -> chave`, e o
 * valor guardado NUNCA muda com o idioma, senao a base de dados passava a
 * depender da lingua de quem cadastrou.
 */
const SITUACOES: [string, TKey][] = [
  ["solteiro", "marital.single"],
  ["casadoUmSalario", "marital.marriedOne"],
  ["casadoDoisSalarios", "marital.marriedTwo"],
  ["familiaMonoparental", "marital.loneParent"],
];
const BASES: [string, TKey][] = [
  ["cumulativa", "basis.cumulative"],
  ["semana1", "basis.week1"],
  ["emergencia", "basis.emergency"],
];

const eur = (c: any) => (c === null || c === undefined || c === "" ? "" : (Number(c) / 100).toFixed(2));
const paraCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v.replace(",", ".")) * 100));

export default function EmployeeForm({
  clientId, blocos, inicial, aoFechar, aoGravar,
}: {
  clientId: string;
  /** Só os blocos que a empresa corre: criar noutro dá um registo fantasma. */
  blocos: FreqType[];
  inicial?: Emp | null;
  aoFechar: () => void;
  aoGravar: () => void | Promise<void>;
}) {
  const { t } = useT();
  const editar = !!inicial?.id;
  const [f, setF] = useState<Emp>(() => ({
    first_name: "", surname: "", start_date: "", end_date: "",
    freq_type: blocos[0] ?? "weekly", pay_type: "Hourly",
    contract_type: "Full time", data_source: "Client sends information",
    job_title: "", hourly_rate: "", sunday_rate: "", fixed_amount: "",
    holiday_opening: "", opening_worked: "", bank_holiday_mode: "Paid",
    active: true, notes: "",
    pps_number: "", prsi_class: "A1", tax_basis: "cumulativa", marital_status: "solteiro",
    usc_reduced: false, usc_exempt: false,
    rpn_number: "", rpn_effective_from: "", rpn_cutoff_cents: null, rpn_credits_cents: null,
    ytd_opening_gross_cents: null, ytd_opening_paye_cents: null,
    ytd_opening_usc_cents: null, ytd_opening_prsi_cents: null, ytd_opening_year: null,
    ...(inicial ?? {}),
  }));
  const [fiscalAberto, setFiscalAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);

  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const horario = f.pay_type === "Hourly";

  // Trocar o bloco re-sincroniza o tipo de pagamento: não existe alguém
  // "mensal" com contrato semanal, e deixar as duas soltas produz um rateio
  // absurdo que ninguém apanha até ver o líquido.
  useEffect(() => {
    const permitidos = payTypesDe(f.freq_type as FreqType);
    if (!permitidos.includes(f.pay_type)) set("pay_type", permitidos[0]);
  }, [f.freq_type]); // eslint-disable-line react-hooks/exhaustive-deps

  async function gravar() {
    setOcupado(true); setErro(null); setAvisos([]);
    try {
      const url = editar
        ? `/api/hr/companies/${clientId}/employees/${inicial!.id}`
        : `/api/hr/companies/${clientId}/employees`;
      const r = await fetch(url, {
        method: editar ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      setAvisos(j.avisos ?? []);
      await aoGravar();
      // Com avisos fica aberto: eles são para ler, e fechar por cima escondia-os.
      if (!(j.avisos ?? []).length) aoFechar();
    } finally { setOcupado(false); }
  }

  const campo = (k: string, rotulo: string, tipo = "text", largura = "w-full") => (
    <label className={`flex flex-col leading-tight ${largura}`}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{rotulo}</span>
      <input type={tipo} className="input mt-1 h-9 py-0 text-sm"
        value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const dinheiro = (k: string, rotulo: string) => (
    <label className="flex flex-col leading-tight">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{rotulo} €</span>
      <input className="input mt-1 h-9 py-0 text-right text-sm tabular-nums"
        value={eur(f[k])} onChange={(e) => set(k, paraCents(e.target.value))} />
    </label>
  );

  return (
    <div className="card mt-3 border-l-4 border-l-brand p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold">
          {editar ? t("emp.edit") : t("emp.new")}
        </h3>
        <button className="btn-ghost h-8 px-3 text-xs" onClick={aoFechar}>{t("common.close")}</button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {campo("first_name", t("emp.firstName"))}
        {campo("surname", t("emp.surname"))}
        {campo("job_title", t("emp.jobTitle"))}
        {campo("start_date", t("emp.start"), "date")}
        {campo("end_date", t("emp.end"), "date")}

        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.block")}</span>
          <select className="input mt-1 h-9 py-0 text-sm" value={f.freq_type}
            onChange={(e) => set("freq_type", e.target.value)}>
            {blocos.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>

        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.payType")}</span>
          <select className="input mt-1 h-9 py-0 text-sm" value={f.pay_type}
            onChange={(e) => set("pay_type", e.target.value)}>
            {payTypesDe(f.freq_type as FreqType).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>

        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.contract")}</span>
          <select className="input mt-1 h-9 py-0 text-sm" value={f.contract_type}
            onChange={(e) => set("contract_type", e.target.value)}>
            {["Full time", "Part time", "Casual"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        {/*
          O lado que não se aplica fica DESACTIVADO e não escondido: ver o campo
          apagado ensina que ele existe e porque é que não se usa aqui.
        */}
        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.hourRate")} €</span>
          <input className="input mt-1 h-9 py-0 text-right text-sm tabular-nums" disabled={!horario}
            value={horario ? (f.hourly_rate ?? "") : ""} onChange={(e) => set("hourly_rate", e.target.value)} />
        </label>
        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.sundayRate")} €</span>
          <input className="input mt-1 h-9 py-0 text-right text-sm tabular-nums" disabled={!horario}
            value={horario ? (f.sunday_rate ?? "") : ""} onChange={(e) => set("sunday_rate", e.target.value)} />
        </label>
        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.contractRate")} €</span>
          <input className="input mt-1 h-9 py-0 text-right text-sm tabular-nums" disabled={horario}
            value={horario ? "" : (f.fixed_amount ?? "")} onChange={(e) => set("fixed_amount", e.target.value)} />
        </label>

        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.bankHoliday")}</span>
          <select className="input mt-1 h-9 py-0 text-sm" value={f.bank_holiday_mode}
            onChange={(e) => set("bank_holiday_mode", e.target.value)}>
            <option value="Paid">{t("emp.bhPaid")}</option>
            <option value="Banked">{t("emp.bhBanked")}</option>
          </select>
        </label>
        <label className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.status")}</span>
          <select className="input mt-1 h-9 py-0 text-sm" value={String(f.active)}
            onChange={(e) => set("active", e.target.value === "true")}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </label>
      </div>

      {/*
        * O IMPOSTO abre FECHADO, e isso é uma decisão e não preguiça.
        *
        * No dia em que alguém entra sabe-se o nome e o salário; o PPS e o RPN
        * chegam depois. Um formulário que exige tudo à cabeça é um formulário
        * que ninguém preenche na hora — e a pessoa fica por cadastrar.
        */}
      <button className="btn-ghost mt-4 h-8 px-3 text-xs"
        onClick={() => setFiscalAberto((v) => !v)}>
        {fiscalAberto ? `− ${t("emp.taxClose")}` : `+ ${t("emp.taxOpen")}`}
      </button>

      {fiscalAberto && (
        <div className="mt-3 rounded-xl2 border border-line bg-surface-2/40 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campo("pps_number", t("emp.pps"))}
            {campo("employment_id", t("emp.employmentId"))}
            <label className="flex flex-col leading-tight">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.prsiClass")}</span>
              <input className="input mt-1 h-9 py-0 text-sm" value={f.prsi_class ?? ""}
                onChange={(e) => set("prsi_class", e.target.value.toUpperCase())} />
            </label>

            <label className="flex flex-col leading-tight">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.basis")}</span>
              <select className="input mt-1 h-9 py-0 text-sm" value={f.tax_basis}
                onChange={(e) => set("tax_basis", e.target.value)}>
                {BASES.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
              </select>
            </label>
            <label className="flex flex-col leading-tight">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.marital")}</span>
              <select className="input mt-1 h-9 py-0 text-sm" value={f.marital_status}
                onChange={(e) => set("marital_status", e.target.value)}>
                {SITUACOES.map(([v, k]) => <option key={v} value={v}>{t(k)}</option>)}
              </select>
            </label>
            <div className="flex flex-col justify-end gap-1 pb-1 text-[12.5px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!f.usc_reduced}
                  onChange={(e) => set("usc_reduced", e.target.checked)} />
                {t("emp.uscReduced")}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!f.usc_exempt}
                  onChange={(e) => set("usc_exempt", e.target.checked)} />
                {t("emp.uscExempt")}
              </label>
            </div>
          </div>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("emp.rpnHeading")}
          </p>
          <p className="text-[12px] text-muted">
            {t("emp.rpnHelp")}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {campo("rpn_number", t("emp.rpnNumber"))}
            {campo("rpn_effective_from", t("emp.rpnFrom"), "date")}
            {dinheiro("rpn_cutoff_cents", t("emp.rpnCutoff"))}
            {dinheiro("rpn_credits_cents", t("emp.rpnCredits"))}
          </div>

          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("emp.ytdHeading")}
          </p>
          <p className="text-[12px] text-muted">
            {t("emp.ytdHelp")}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col leading-tight">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{t("emp.ytdYear")}</span>
              <input className="input mt-1 h-9 py-0 text-right text-sm tabular-nums"
                value={f.ytd_opening_year ?? ""}
                onChange={(e) => set("ytd_opening_year", e.target.value ? Number(e.target.value) : null)} />
            </label>
            {dinheiro("ytd_opening_gross_cents", t("emp.ytdGross"))}
            {dinheiro("ytd_opening_paye_cents", t("emp.ytdPaye"))}
            {dinheiro("ytd_opening_usc_cents", t("emp.ytdUsc"))}
            {dinheiro("ytd_opening_prsi_cents", t("emp.ytdPrsi"))}
          </div>
        </div>
      )}

      {erro && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{erro}</p>}
      {!!avisos.length && (
        <ul className="mt-3 space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px]">
          {avisos.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary h-9 px-4 text-sm" disabled={ocupado} onClick={gravar}>
          {ocupado ? t("common.saving") : editar ? t("common.save") : t("emp.create")}
        </button>
        {!!avisos.length && (
          <button className="btn-ghost h-9 px-4 text-sm" onClick={aoFechar}>{t("emp.closeAnyway")}</button>
        )}
      </div>
    </div>
  );
}
