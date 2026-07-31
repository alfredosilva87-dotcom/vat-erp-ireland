"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ClientWithStats } from "@/lib/types";
import { ACTIVITIES } from "@/lib/activities";
import { getCurrentClient, setCurrentClient } from "@/lib/currentClient";

const money = (n: number) => n.toLocaleString("en-IE", { minimumFractionDigits: 2 });
const empty = {
  name: "", client_code: "", vat_number: "", tax_reg_no: "",
  activity_code: "RESTAURANT", default_credit_unmatched: false,
  email: "", phone: "", address: "", notes: "",
};

export default function Clients() {
  const [clients, setClients] = useState<ClientWithStats[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [editId, setEditId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/clients?stats=1");
    const data = await res.json();
    setClients(data.clients || []);
  }, []);

  useEffect(() => {
    load();
    setCurrentId(getCurrentClient()?.id ?? null);
  }, [load]);

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
      email: c.email || "", phone: c.phone || "", address: c.address || "", notes: c.notes || "",
    });
    setShowForm(true);
  }

  async function remove(id: string) {
    if (!confirm("Delete this client? Their invoices stay in the database but become unassigned.")) return;
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

      {showForm && (
        <div className="card rise p-5">
          <h2 className="font-display text-lg font-semibold">{editId ? "Edit client" : "New client"}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Company name *">
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
            <Field label="VAT number">
              <input className="input" value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} placeholder="IE1234567X" />
            </Field>
            <Field label="Tax Registration No (Revenue)">
              <input className="input" value={form.tax_reg_no} onChange={(e) => setForm({ ...form, tax_reg_no: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Address">
              <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
            <Field label="Notes">
              <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-xl2 border border-line bg-paper p-3">
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
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" onClick={submit}>{editId ? "Save changes" : "Create client"}</button>
            {msg && <span className="text-sm text-danger">{msg}</span>}
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-paper text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">VAT / TRN</th>
                <th className="px-4 py-3 font-medium text-right">Invoices</th>
                <th className="px-4 py-3 font-medium text-right">Credit €</th>
                <th className="px-4 py-3 font-medium text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className={`border-b border-line/70 ${currentId === c.id ? "bg-ok-50/60" : ""}`}>
                  <td className="px-4 py-3 font-mono text-xs">{c.client_code}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{c.name}</div>
                    {c.email && <div className="text-xs text-muted">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3">{c.activity_label}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {c.vat_number || "—"}
                    {c.tax_reg_no ? ` · ${c.tax_reg_no}` : ""}
                  </td>
                  <td className="px-4 py-3 text-right tnum">{c.invoice_count}</td>
                  <td className="px-4 py-3 text-right tnum font-semibold text-brand-700">{money(c.total_credit)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
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
              {!clients.length && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted">
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
