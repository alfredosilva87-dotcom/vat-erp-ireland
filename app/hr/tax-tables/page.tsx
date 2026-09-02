"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * As TABELAS FISCAIS, editáveis.
 *
 * Pedido do Alfredo: "cria algo que possa alterar esses impostos quando as
 * regras mudarem, precisa ser cadastrado e não na raiz."
 *
 * As taxas irlandesas mudam todos os anos no Orçamento, e o PRSI já mudou a
 * meio do ano duas vezes seguidas. Com os números no código, cada mudança
 * exigia alterar, buildar e reimplantar em cada instalação — e a folha de
 * Janeiro não espera por isso.
 *
 * O ecrã trabalha em EUROS e por CENTO, que é como a Revenue publica. O que vai
 * para o banco são cêntimos e pontos-base inteiros: escrever "20%" e guardar
 * 0,2 é como se perde um cêntimo por linha durante um ano inteiro.
 */

type Cab = Record<string, any> | null;
type Banda = { reduced: boolean; ord: number; upto_cents: number | null; rate_bps: number };
type Prsi = Record<string, any>;

const eur = (c: number | null | undefined) => (c === null || c === undefined ? "" : (Number(c) / 100).toFixed(2));
const pct = (bps: number | null | undefined) => (bps === null || bps === undefined ? "" : (Number(bps) / 100).toFixed(2));
const paraCents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v.replace(",", ".")) * 100));
const paraBps = (v: string) => Math.round(Number(v.replace(",", ".")) * 100);

const CAMPOS_EUR: [string, string][] = [
  ["cutoff_single_cents", "Cut-off — single"],
  ["cutoff_lone_parent_cents", "Cut-off — lone parent"],
  ["cutoff_married_one_cents", "Cut-off — married, one income"],
  ["cutoff_married_two_cents", "Cut-off — married, two incomes"],
  ["cutoff_transfer_max_cents", "Cut-off — max transferable"],
  ["credit_personal_single_cents", "Credit — personal (single)"],
  ["credit_personal_married_cents", "Credit — personal (married)"],
  ["credit_employee_cents", "Credit — employee (PAYE)"],
  ["credit_lone_parent_cents", "Credit — lone parent"],
  ["emergency_weekly_cutoff_cents", "Emergency — weekly cut-off"],
  ["usc_exemption_annual_cents", "USC — annual exemption"],
  ["usc_reduced_limit_cents", "USC — reduced-rate ceiling"],
];

export default function TaxTablesPage() {
  const [ano, setAno] = useState(() => new Date().getFullYear());
  const [anos, setAnos] = useState<{ year: number; confirmed_at: string | null }[]>([]);
  const [cab, setCab] = useState<Cab>(null);
  const [bandas, setBandas] = useState<Banda[]>([]);
  const [prsi, setPrsi] = useState<Prsi[]>([]);
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null); setFeito(false);
    const r = await fetch(`/api/hr/tax-tables?year=${ano}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error || "Falhou."); return; }
    setAnos(j.anos); setCab(j.cabecalho); setBandas(j.bandas); setPrsi(j.prsi);
    setConfirmar(!!j.cabecalho?.confirmed_at);
  }, [ano]);

  useEffect(() => { carregar(); }, [carregar]);

  function mexerCab(k: string, v: any) { setCab((c) => ({ ...(c || {}), [k]: v })); }

  async function gravar() {
    setOcupado(true); setErro(null); setFeito(false);
    try {
      const r = await fetch("/api/hr/tax-tables", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: ano, cabecalho: cab, bandas, prsi, confirmar }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falhou."); return; }
      setFeito(true);
      await carregar();
    } finally { setOcupado(false); }
  }

  const porConfirmar = cab && !cab.confirmed_at;

  return (
    <div className="space-y-4">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Tabelas fiscais</h1>
          <p className="mt-1 max-w-3xl text-muted">
            PAYE, USC e PRSI, por ano. É daqui que a folha tira os números — mudar aqui muda
            a folha seguinte, sem alterar o sistema.
          </p>
        </div>
        <label className="flex flex-col leading-tight">
          <span className="text-[9.5px] font-medium uppercase tracking-wide text-muted">Ano</span>
          <select className="input h-9 w-auto cursor-pointer py-0 text-[13px] font-semibold"
            value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {[...new Set([...anos.map((a) => a.year), ano, new Date().getFullYear() + 1])]
              .sort((a, b) => b - a)
              .map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      {/*
        * O AVISO de tabela por confirmar é a peça mais importante deste ecrã.
        *
        * Um número de imposto errado não dá erro — dá um líquido plausível e uma
        * dívida à Revenue que aparece meses depois. Enquanto ninguém conferir
        * contra revenue.ie, isto tem de estar à vista.
        */}
      {porConfirmar && (
        <div className="card border-l-4 border-l-warning p-4">
          <p className="text-sm">
            <span className="chip-warn mr-2">por conferir</span>
            Esta tabela ainda não foi conferida contra a Revenue. A folha calcula na mesma —
            recusar deixaria o escritório parado — mas cada payslip sai marcado.
          </p>
          {cab?.source && <p className="mt-1 text-[12.5px] text-muted">{cab.source}</p>}
        </div>
      )}

      <section className="card p-5">
        <h2 className="font-display text-base font-semibold">PAYE</h2>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex flex-col leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Standard rate %</span>
            <input className="input mt-1 h-9 w-28 py-0 text-right tabular-nums"
              value={pct(cab?.rate_standard_bps)}
              onChange={(e) => mexerCab("rate_standard_bps", paraBps(e.target.value))} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Higher rate %</span>
            <input className="input mt-1 h-9 w-28 py-0 text-right tabular-nums"
              value={pct(cab?.rate_higher_bps)}
              onChange={(e) => mexerCab("rate_higher_bps", paraBps(e.target.value))} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Emergency — weeks with cut-off</span>
            <input className="input mt-1 h-9 w-28 py-0 text-right tabular-nums"
              value={cab?.emergency_weeks_with_cutoff ?? ""}
              onChange={(e) => mexerCab("emergency_weeks_with_cutoff", Number(e.target.value))} />
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAMPOS_EUR.map(([k, rotulo]) => (
            <label key={k} className="flex flex-col leading-tight">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{rotulo} €</span>
              <input className="input mt-1 h-9 py-0 text-right tabular-nums"
                value={eur(cab?.[k])}
                onChange={(e) => mexerCab(k, paraCents(e.target.value))} />
            </label>
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-display text-base font-semibold">USC — bandas</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          Limite superior anual de cada banda. Deixe o limite em branco na última: é ela que
          apanha tudo daí para cima, e sem ela rendimento alto ficava por tributar em silêncio.
        </p>
        {[false, true].map((red) => (
          <div key={String(red)} className="mt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {red ? "Taxas reduzidas (cartão médico, 70+)" : "Taxas normais"}
            </h3>
            <div className="-mx-1 mt-1 overflow-x-auto px-1">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                    <th className="py-1.5 text-left">Ordem</th>
                    <th className="py-1.5 text-right">Até €/ano</th>
                    <th className="py-1.5 text-right">Taxa %</th>
                    <th className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {bandas.filter((b) => !!b.reduced === red).map((b) => (
                    <tr key={`${red}-${b.ord}`} className="border-b border-line/50">
                      <td className="py-1.5 font-mono text-muted">{b.ord}</td>
                      <td className="py-1.5">
                        <input className="input h-8 w-full py-0 text-right tabular-nums"
                          placeholder="(sem topo)"
                          value={eur(b.upto_cents)}
                          onChange={(e) => setBandas((bs) => bs.map((x) =>
                            x === b ? { ...x, upto_cents: paraCents(e.target.value) } : x))} />
                      </td>
                      <td className="py-1.5">
                        <input className="input h-8 w-24 py-0 text-right tabular-nums"
                          value={pct(b.rate_bps)}
                          onChange={(e) => setBandas((bs) => bs.map((x) =>
                            x === b ? { ...x, rate_bps: paraBps(e.target.value) } : x))} />
                      </td>
                      <td className="py-1.5 text-right">
                        <button className="text-[12px] text-danger underline"
                          onClick={() => setBandas((bs) => bs.filter((x) => x !== b))}>remover</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn-ghost mt-2 h-8 px-3 text-xs"
              onClick={() => setBandas((bs) => [...bs, {
                reduced: red, ord: bs.filter((x) => !!x.reduced === red).length + 1,
                upto_cents: null, rate_bps: 0,
              }])}>
              + banda
            </button>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <h2 className="font-display text-base font-semibold">PRSI</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          Cada linha vale a partir da data dela. É por isso que há mais de uma por ano: uma
          alteração de Outubro não pode reescrever o que já foi pago em Setembro.
        </p>
        <div className="-mx-1 mt-3 overflow-x-auto px-1">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                <th className="py-1.5 text-left">Vale desde</th>
                <th className="py-1.5 text-right">Empregado %</th>
                <th className="py-1.5 text-right">Isento até €/sem</th>
                <th className="py-1.5 text-right">Crédito máx €</th>
                <th className="py-1.5 text-right">Crédito até €/sem</th>
                <th className="py-1.5 text-right">Patrão baixo %</th>
                <th className="py-1.5 text-right">Patrão alto %</th>
                <th className="py-1.5 text-right">Degrau €/sem</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {prsi.map((p, i) => {
                const mexer = (k: string, v: any) =>
                  setPrsi((ps) => ps.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
                const num = (k: string, conv: (s: string) => any, mostra: (v: any) => string) => (
                  <td className="py-1.5 pl-2">
                    <input className="input h-8 w-24 py-0 text-right tabular-nums"
                      value={mostra(p[k])} onChange={(e) => mexer(k, conv(e.target.value))} />
                  </td>
                );
                return (
                  <tr key={i} className="border-b border-line/50">
                    <td className="py-1.5">
                      <input type="date" className="input h-8 w-36 py-0"
                        value={String(p.effective_from || "").slice(0, 10)}
                        onChange={(e) => mexer("effective_from", e.target.value)} />
                    </td>
                    {num("employee_bps", paraBps, pct)}
                    {num("employee_exempt_weekly_cents", (s) => paraCents(s), eur)}
                    {num("credit_max_cents", (s) => paraCents(s), eur)}
                    {num("credit_upto_weekly_cents", (s) => paraCents(s), eur)}
                    {num("employer_lower_bps", paraBps, pct)}
                    {num("employer_higher_bps", paraBps, pct)}
                    {num("employer_threshold_weekly_cents", (s) => paraCents(s), eur)}
                    <td className="py-1.5 pl-2 text-right">
                      <button className="text-[12px] text-danger underline"
                        onClick={() => setPrsi((ps) => ps.filter((_, j) => j !== i))}>remover</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="btn-ghost mt-2 h-8 px-3 text-xs"
          onClick={() => setPrsi((ps) => [...ps, {
            effective_from: `${ano}-01-01`, employee_bps: 420,
            employee_exempt_weekly_cents: 35200, credit_max_cents: 1200,
            credit_upto_weekly_cents: 42400, employer_lower_bps: 900,
            employer_higher_bps: 1125, employer_threshold_weekly_cents: 49600,
          }])}>
          + linha
        </button>
      </section>

      <section className="card p-5">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5" checked={confirmar}
            onChange={(e) => setConfirmar(e.target.checked)} />
          <span className="text-sm">
            <strong>Conferida contra a Revenue.</strong>
            <span className="ml-1 text-muted">
              Fica gravado quem marcou e quando. Sem isto, cada payslip sai com aviso —
              e é essa marca que alguém vai invocar daqui a seis meses para justificar um número.
            </span>
          </span>
        </label>
        {cab?.confirmed_at && (
          <p className="mt-2 text-[12.5px] text-muted">
            Conferida em {String(cab.confirmed_at).slice(0, 10)}.
          </p>
        )}

        <label className="mt-4 block">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted">Procedência</span>
          <input className="input mt-1 w-full text-sm" value={cab?.source ?? ""}
            onChange={(e) => mexerCab("source", e.target.value)}
            placeholder="De onde vieram estes números — Budget 2026, circular da Revenue, etc." />
        </label>

        {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}
        {feito && <p className="mt-3 text-sm text-ok">Gravado. A folha seguinte já usa estes números.</p>}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="btn-primary h-9 px-4 text-sm" disabled={ocupado} onClick={gravar}>
            {ocupado ? "A gravar…" : "Guardar tabela"}
          </button>
          <span className="text-[11.5px] text-muted">Alterar uma taxa exige administrador.</span>
        </div>
      </section>
    </div>
  );
}
