"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type Doc = {
  id: string; lado: "entrada" | "saida"; data: string | null;
  parte: string | null; numero: string | null;
  liquido: number; vat: number; total: number;
  document_path: string | null; original_filename: string | null;
};

/**
 * As notas de entrada e saída de um período, e o botão que as entrega.
 *
 * A tela existe para a pergunta do fecho: "o que entrou e saiu neste período,
 * e cadê os documentos?". Compras e Vendas respondem cada uma metade; aqui as
 * duas ficam na mesma linha do tempo, que é como se confere contra o extrato.
 *
 * O exportar leva EXATAMENTE o que está filtrado na tela — mesmo período,
 * mesmos lados. Um botão que exporta outra coisa do que a pessoa está a ver é
 * a forma mais barata de entregar o arquivo errado ao cliente.
 */
export default function PeriodDocuments({ params }: { params: { id: string } }) {
  const { t } = useT();
  const hoje = new Date().toISOString().slice(0, 10);
  const [de, setDe] = useState(`${hoje.slice(0, 4)}-01-01`);
  const [ate, setAte] = useState(hoje);
  const [entrada, setEntrada] = useState(true);
  const [saida, setSaida] = useState(true);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const lados = [entrada && "entrada", saida && "saida"].filter(Boolean).join(",");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/clients/${params.id}/documents?from=${de}&to=${ate}&sides=${lados}`,
        { cache: "no-store" }
      );
      if (!r.ok) throw new Error((await r.json()).error || "Falhou.");
      setDocs((await r.json()).docs || []);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [params.id, de, ate, lados]);

  useEffect(() => { load(); }, [load]);

  const eur = (v: number) =>
    "€" + v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const soma = (l: Doc[], k: "liquido" | "vat" | "total") => l.reduce((s, d) => s + d[k], 0);
  const ent = docs.filter((d) => d.lado === "entrada");
  const sai = docs.filter((d) => d.lado === "saida");
  const semDoc = docs.filter((d) => !d.document_path).length;

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">{t("period.title")}</h1>
          <p className="mt-1 text-muted">{t("period.subtitle")}</p>
        </div>
        <a
          className={`btn-primary ${docs.length ? "" : "pointer-events-none opacity-50"}`}
          href={`/api/clients/${params.id}/documents/bundle.pdf?from=${de}&to=${ate}&sides=${lados}`}
        >
          {t("period.exportPdf", { n: docs.length })}
        </a>
      </div>

      <div className="card flex flex-wrap items-end gap-4 p-4">
        <div>
          <label className="label">{t("period.from")}</label>
          <input type="date" className="input w-auto" value={de} onChange={(e) => setDe(e.target.value)} />
        </div>
        <div>
          <label className="label">{t("period.to")}</label>
          <input type="date" className="input w-auto" value={ate} onChange={(e) => setAte(e.target.value)} />
        </div>
        <div className="flex items-center gap-4 pb-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={entrada}
              onChange={(e) => setEntrada(e.target.checked)} />
            {t("period.in")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={saida}
              onChange={(e) => setSaida(e.target.checked)} />
            {t("period.out")}
          </label>
        </div>
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao rotulo={t("period.inCount")} valor={String(ent.length)} nota={eur(soma(ent, "total"))} />
        <Cartao rotulo={t("period.inVat")} valor={eur(soma(ent, "vat"))} />
        <Cartao rotulo={t("period.outCount")} valor={String(sai.length)} nota={eur(soma(sai, "total"))} />
        <Cartao rotulo={t("period.outVat")} valor={eur(soma(sai, "vat"))} />
      </div>

      {semDoc > 0 && <p className="text-sm text-muted">{t("period.missingDocs", { n: semDoc })}</p>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">{t("period.colDate")}</th>
                <th className="px-4 py-2.5 font-medium">{t("period.colSide")}</th>
                <th className="px-4 py-2.5 font-medium">{t("period.colParty")}</th>
                <th className="px-4 py-2.5 font-medium">{t("period.colNumber")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("period.colNet")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("period.colVat")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t("period.colTotal")}</th>
                <th className="px-4 py-2.5 font-medium">{t("period.colDoc")}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={`${d.lado}:${d.id}`} className="border-b border-line/70">
                  <td className="px-4 py-2 font-mono text-xs text-muted">{d.data || "—"}</td>
                  <td className="px-4 py-2">
                    <span className={d.lado === "entrada" ? "chip bg-brand-50 text-brand-700" : "chip-ok"}>
                      {d.lado === "entrada" ? t("period.in") : t("period.out")}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium">{d.parte || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted">{d.numero || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{eur(d.liquido)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{eur(d.vat)}</td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">{eur(d.total)}</td>
                  <td className="px-4 py-2">
                    {d.document_path
                      ? <span className="chip-ok">{t("period.hasDoc")}</span>
                      : <span className="chip bg-surface-2 text-muted">{t("period.noDoc")}</span>}
                  </td>
                </tr>
              ))}
              {!docs.length && !loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">{t("period.empty")}</td></tr>
              )}
              {loading && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line bg-surface-2/60 px-4 py-2.5 text-xs text-muted">
          {t("period.exportNote")}
        </div>
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{rotulo}</div>
      <div className="mt-0.5 font-display text-xl font-semibold tabular-nums">{valor}</div>
      {nota && <div className="mt-0.5 text-xs text-muted">{nota}</div>}
    </div>
  );
}
