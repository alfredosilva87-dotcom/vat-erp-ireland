"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ClientWithStats } from "@/lib/types";
import { ACTIVITIES } from "@/lib/activities";
import { getCurrentClient, setCurrentClient } from "@/lib/currentClient";
import { useT } from "@/lib/i18n";
import WhatsAppLink from "@/components/WhatsAppLink";
import { avisoVatIrlandes, avisoEmail, avisoTelefone } from "@/lib/fiscal/identificadores";

const money = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2 });
/**
 * O NOME TEM TECTO, E O TIPO NASCE NEUTRO.
 *
 * `NOME_MAX`: um nome de 503 caracteres esticou a tabela de clientes para
 * 5.341 px numa janela de 1.440 e empurrou a coluna de acções inteira para
 * fora do ecrã — incluindo o `Delete` que desfaria o estrago. 160 é folgado
 * para qualquer razão social real.
 *
 * `activity_code`: era "RESTAURANT" por ser a PRIMEIRA da lista, não por ser a
 * mais provável — e um `<select>` que ninguém toca grava a primeira opção. O
 * tipo de negócio comanda as regras de crédito de IVA, portanto um
 * transportador criado à pressa ficava com regras de restauração e ninguém
 * via. "GENERIC" é o neutro: não acerta sozinho, mas também não erra em
 * silêncio a favor de um sector ao calhas.
 */
const NOME_MAX = 160;
const empty = {
  name: "", client_code: "", vat_number: "", tax_reg_no: "",
  activity_code: "GENERIC", default_credit_unmatched: false,
  related_categories: [] as string[],
  email: "", phone: "", address: "", notes: "",
};

export default function Clients() {
  const { t } = useT();
  const [clients, setClients] = useState<ClientWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...empty });
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [categories, setCategories] = useState<{ code: string | null; description: string; vat_rate: number }[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/clients?stats=1", { cache: "no-store" });
      const data = await res.json();
      setClients(data.clients || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    setCurrentId(getCurrentClient()?.id ?? null);
    fetch("/api/base", { cache: "no-store" }).then((r) => r.json()).then((d) => setCategories(d.categories || []));
  }, [load]);

  function toggleCategory(code: string) {
    setForm((f) => ({
      ...f,
      related_categories: f.related_categories.includes(code)
        ? f.related_categories.filter((c) => c !== code)
        : [...f.related_categories, code],
    }));
  }

  async function submit() {
    if (!form.name.trim()) {
      setMsg("Name is required.");
      return;
    }
    const activity = ACTIVITIES.find((a) => a.code === form.activity_code);
    const body = { ...form, activity_label: activity?.label || "Generic business" };
    const url = editId ? `/api/clients/${editId}` : "/api/clients";
    const res = await fetch(url, {
      method: editId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error);
      return;
    }
    setForm({ ...empty });
    setEditId(null);
    setShowForm(false);
    setMsg(null);
    load();
  }

  function edit(c: ClientWithStats) {
    setEditId(c.id);
    setForm({
      name: c.name, client_code: c.client_code, vat_number: c.vat_number || "",
      tax_reg_no: c.tax_reg_no || "", activity_code: c.activity_code,
      default_credit_unmatched: c.default_credit_unmatched,
      related_categories: c.related_categories || [],
      email: c.email || "", phone: c.phone || "", address: c.address || "", notes: c.notes || "",
    });
    setShowForm(true);
  }

  async function remove(id: string) {
    /*
     * A confirmação passa a dizer QUANTAS faturas ficam sem dono.
     *
     * O texto anterior anunciava a consequência sem a medir — "their invoices
     * become unassigned" —, e zero faturas e vinte e sete faturas pedem
     * decisões opostas. O número já está na linha da tabela; só não estava a
     * ser usado onde decide.
     */
    const c = clients.find((x) => x.id === id);
    const n = c?.invoice_count ?? 0;
    const aviso = n > 0
      ? `Apagar ${c?.name || "este cliente"}?\n\n${n} fatura(s) ficam na base de dados SEM DONO — deixam de aparecer nas listas por cliente. Use o filtro "sem cliente" na Base de dados para as encontrar depois.`
      : `Apagar ${c?.name || "este cliente"}? Não tem faturas associadas.`;
    if (!confirm(aviso)) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    if (currentId === id) {
      setCurrentClient(null);
      setCurrentId(null);
    }
    load();
  }

  function select(c: ClientWithStats) {
    setCurrentClient({ id: c.id, name: c.name, activity_code: c.activity_code });
    setCurrentId(c.id);
  }

  return (
    <div className="space-y-8">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="mt-1 text-muted">
            Register the companies you manage. Selecting a client scopes every screen to it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="btn-ghost"
            onClick={() => { window.location.href = "/api/companies/contacts.sage.csv"; }}
          >
            {t("clients.exportContacts")}
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              setEditId(null);
              setForm({ ...empty });
              setShowForm((v) => !v);
            }}
          >
            {showForm ? "Close" : "New client"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card rise p-5">
          <h2 className="font-display text-lg font-semibold">{editId ? "Edit client" : "New client"}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Company name *">
              <input className="input" maxLength={NOME_MAX} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Client code (optional, auto)">
              <input className="input" value={form.client_code} onChange={(e) => setForm({ ...form, client_code: e.target.value })} placeholder="auto" disabled={!!editId} />
            </Field>
            <Field label="Company type">
              <select className="input" value={form.activity_code} onChange={(e) => setForm({ ...form, activity_code: e.target.value })}>
                {ACTIVITIES.map((a) => (
                  <option key={a.code} value={a.code}>{a.label}</option>
                ))}
              </select>
            </Field>
            {/*
              Os avisos AVISAM, não bloqueiam — ver lib/fiscal/identificadores.ts.
              Um número estrangeiro, ou ainda por confirmar, tem de poder ser
              gravado; o que não pode é `XXXX` entrar calado num campo que vai
              parar ao VAT3.
            */}
            <Field label="VAT number">
              <input className="input" maxLength={20} value={form.vat_number}
                onChange={(e) => setForm({ ...form, vat_number: e.target.value.toUpperCase() })} placeholder="IE1234567X" />
              <Aviso r={avisoVatIrlandes(form.vat_number)} />
            </Field>
            <Field label="Tax Registration No (Revenue)">
              <input className="input" maxLength={20} value={form.tax_reg_no}
                onChange={(e) => setForm({ ...form, tax_reg_no: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" maxLength={160} value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nome@empresa.ie" />
              <Aviso r={avisoEmail(form.email)} />
            </Field>
            <Field label="Phone">
              <input className="input" type="tel" maxLength={24} value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+353 83 838 0361" />
              <Aviso r={avisoTelefone(form.phone)} />
            </Field>
            <Field label="Address">
              <input className="input" maxLength={240} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input className="input" maxLength={500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4 rounded-xl2 border border-line bg-surface-2 p-3">
            <div className="text-sm font-medium">Categories this client sells / uses</div>
            <p className="mt-0.5 text-xs text-muted">
              Optional. Once you pick at least one, an item on a purchase invoice whose category
              isn&apos;t in this list gets flagged &quot;verify&quot; on the item line and on the invoice.
              Leave empty to keep this check off (default).
            </p>
            <div className="mt-2 flex max-h-40 flex-wrap gap-x-4 gap-y-1.5 overflow-y-auto">
              {categories.filter((c) => c.code).map((c) => (
                <label key={c.code} className="flex cursor-pointer items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.related_categories.includes(c.code!)}
                    onChange={() => toggleCategory(c.code!)}
                    className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
                  />
                  {c.description}
                </label>
              ))}
              {!categories.length && <span className="text-xs text-muted">Loading categories…</span>}
            </div>
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-line bg-surface-2 p-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, default_credit_unmatched: !form.default_credit_unmatched })}
              role="switch" aria-checked={form.default_credit_unmatched}
              className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${form.default_credit_unmatched ? "bg-brand" : "bg-line"}`}
            >
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.default_credit_unmatched ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
            <div>
              <div className="text-sm font-medium">Auto-approve credit for unmatched items</div>
              <p className="text-xs text-muted">
                Off (recommended): items with no specific credit rule start unchecked — you review each one.
                On: they start checked by default. Only known blocks (entertainment, passenger-car fuel, accommodation) and
                this client&apos;s business-type rules are unaffected either way.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-primary" onClick={submit}>{editId ? "Save changes" : "Create client"}</button>
            {msg && <span className="text-sm text-danger">{msg}</span>}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2/60 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">VAT / TRN</th>
                <th className="px-4 py-3 font-medium text-right">Invoices</th>
                <th className="px-4 py-3 font-medium text-right">Credit €</th>
                {/* Aberto a partir do cadastro, que e onde alguem esta quando
                    se lembra de falar com o cliente. */}
                <th className="px-4 py-3 text-center font-medium">WA</th>
                <th className="px-4 py-3 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className={`border-b border-line/70 ${currentId === c.id ? "bg-ok-50/60" : ""}`}>
                  <td className="px-4 py-3 font-mono text-xs">{c.client_code}</td>
                  {/*
                    Tecto de largura + reticências na célula do nome.
                    O `maxLength` do formulário impede o dado sujo daqui para a
                    frente; isto é a outra metade — impede que um nome comprido
                    já gravado (ou colado por API) volte a empurrar a coluna de
                    acções para fora do ecrã, que era o que escondia o próprio
                    botão de apagar.
                  */}
                  <td className="px-4 py-3 max-w-[280px]">
                    <div className="truncate font-medium" title={c.name}>{c.name}</div>
                    {c.email && <div className="truncate text-xs text-muted" title={c.email}>{c.email}</div>}
                  </td>
                  <td className="px-4 py-3">{c.activity_label}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {c.vat_number || "—"}
                    {c.tax_reg_no ? ` · ${c.tax_reg_no}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right tnum">{c.invoice_count}</td>
                  <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">{money(c.total_credit)}</td>
                  <td className="px-4 py-3 text-center">
                    <WhatsAppLink phone={c.phone} nome={c.name} semTelefone={t("hr.waNoPhone")} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      <Link className="btn-ghost h-8 px-3 text-xs" href={`/clients/${c.id}`}>Open</Link>
                      {currentId === c.id ? (
                        <span className="chip-ok">Selected</span>
                      ) : (
                        <button className="btn-ghost h-8 px-3 text-xs" onClick={() => select(c)}>Select</button>
                      )}
                      <button className="btn-ghost h-8 px-3 text-xs" onClick={() => edit(c)}>Edit</button>
                      <button className="btn-ghost h-8 px-3 text-xs text-danger" onClick={() => remove(c.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {/*
                "Ainda não sei" e "já sei, e está vazio" deixam de ser a mesma
                coisa. A tela dizia "No clients yet" durante o segundo em que os
                dados vinham a caminho — e para um contabilista que abre o
                sistema de manhã, ler que não há clientes parece perda de dados,
                não lentidão.
              */}
              {loading && !clients.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td>
                </tr>
              )}
              {!loading && !clients.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    No clients yet. Click “New client” to register the first company.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/**
 * O aviso amarelo por baixo do campo.
 *
 * Amarelo e não vermelho de propósito: isto não impede de gravar. Diz "olhe
 * bem para isto" a quem está a escrever, no momento em que está a escrever —
 * que é a única altura em que corrigir custa um segundo.
 */
function Aviso({ r }: { r: { ok: boolean; chave?: string } }) {
  const { t } = useT();
  if (r.ok || !r.chave) return null;
  return <p className="mt-1 text-xs text-warning">{t(r.chave as any)}</p>;
}
