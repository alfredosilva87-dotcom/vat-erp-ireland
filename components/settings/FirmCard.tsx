"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Os dados do escritório que saem impressos no timbre das demonstrações.
 *
 * Ficam aqui, e não numa tela nova, porque é um formulário de oito campos que
 * se preenche uma vez na vida — uma rota inteira para isso só acrescentaria um
 * clique entre a pessoa e o que ela veio fazer.
 *
 * A pré-visualização à direita não é enfeite: estes campos só aparecem no PDF
 * do balanço, que é preciso gerar para ver. Sem ela, quem escreve a morada com
 * um erro só descobre depois de mandar o relatório ao cliente.
 */

type Timbre = {
  name: string; address: string | null; phone: string | null; website: string | null;
  contact_email: string | null; registration_no: string | null;
  signer_name: string | null; signer_title: string | null;
};

const VAZIO: Timbre = {
  name: "", address: null, phone: null, website: null,
  contact_email: null, registration_no: null, signer_name: null, signer_title: null,
};

const CAMPOS: { k: keyof Timbre; label: string; dica?: string; largo?: boolean }[] = [
  { k: "name", label: "Firm name" },
  { k: "registration_no", label: "Professional registration", dica: "CPA / ACCA / CAI number of whoever signs" },
  { k: "address", label: "Address", largo: true },
  { k: "phone", label: "Phone" },
  { k: "contact_email", label: "E-mail" },
  { k: "website", label: "Website" },
  { k: "signer_name", label: "Signed by" },
  { k: "signer_title", label: "Title", dica: "Printed under the signature line" },
];

export default function FirmCard({ companyId }: { companyId: string }) {
  const [f, setF] = useState<Timbre>(VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [gravando, setGravando] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; ok: boolean } | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/companies/${companyId}/letterhead`, { cache: "no-store" });
      if (r.ok) setF({ ...VAZIO, ...(await r.json()) });
    } finally {
      setCarregando(false);
    }
  }, [companyId]);

  useEffect(() => { carregar(); }, [carregar]);

  async function gravar() {
    setGravando(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/companies/${companyId}/letterhead`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not save.");
      setF({ ...VAZIO, ...d });
      setMsg({ texto: "Saved — it shows on the next report you generate.", ok: true });
    } catch (e: any) {
      setMsg({ texto: e.message, ok: false });
    } finally {
      setGravando(false);
    }
  }

  const v = (k: keyof Timbre) => f[k] ?? "";
  const linhas = [v("address"), [v("phone"), v("website")].filter(Boolean).join("  ·  "), v("contact_email")]
    .filter((l) => String(l).trim() !== "");

  return (
    <section id="firm" className="card p-5">
      <h2 className="font-display text-lg font-semibold">Firm details</h2>
      <p className="text-sm text-muted">
        Printed on the balance sheet, profit and loss and trial balance you hand to clients.
        Anything left blank is simply left off the page.
      </p>

      {carregando ? (
        <div className="mt-4 text-sm text-muted">…</div>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
          <div className="grid gap-3 sm:grid-cols-2">
            {CAMPOS.map((c) => (
              <div key={c.k} className={c.largo ? "sm:col-span-2" : undefined}>
                <label className="label" htmlFor={`firm-${c.k}`}>{c.label}</label>
                <input
                  id={`firm-${c.k}`} className="input w-full" value={v(c.k)}
                  onChange={(e) => setF({ ...f, [c.k]: e.target.value })}
                />
                {c.dica && <p className="mt-1 text-xs text-muted">{c.dica}</p>}
              </div>
            ))}
          </div>

          {/* Como vai sair no papel */}
          <div>
            <div className="label">On the report</div>
            <div className="rounded-xl border border-line bg-surface-2/50 p-3">
              <div className="h-1.5 w-full rounded-full bg-brand" />
              <div className="mt-3 text-sm font-semibold">{v("name") || "—"}</div>
              {linhas.map((l, i) => (
                <div key={i} className="text-xs text-muted">{l}</div>
              ))}
              <div className="mt-4 border-t border-line pt-2">
                <div className="h-px w-32 bg-muted/40" />
                <div className="mt-1 text-xs font-medium">{v("signer_name") || "—"}</div>
                <div className="text-[11px] text-muted">
                  {[v("signer_title"), v("registration_no")].filter(Boolean).join("  ·  ") || "—"}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary h-9 px-4 text-sm" disabled={gravando || carregando} onClick={gravar}>
          {gravando ? "…" : "Save"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.texto}</span>}
      </div>
    </section>
  );
}
