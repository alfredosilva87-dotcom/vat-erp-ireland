"use client";

/**
 * O endereço de e-mail do cliente e quem pode mandar para ele (camada B2).
 *
 * Dois endereços, um para compra e um para venda, porque uma nota que entra como
 * venda quando era compra troca o sinal do VAT — não é um detalhe de organização.
 *
 * O endereço aparece inteiro e com botão de copiar porque o uso dele é ser colado
 * no cadastro do fornecedor. Mostrar só o token daria ao contador metade do que
 * ele precisa.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Route = {
  id: string; client_id: string; direction: "purchase" | "sale";
  token: string; active: boolean; created_at: string;
};
type Sender = {
  id: string; client_id: string | null; pattern: string;
  mode: "allow" | "block"; note: string | null;
};

const DIRECTIONS: { v: "purchase" | "sale"; label: string; hint: string }[] = [
  { v: "purchase", label: "Compras (T2)", hint: "Fatura que o fornecedor emite contra o cliente." },
  { v: "sale", label: "Vendas (T1)", hint: "Nota que o cliente emite. Entra como venda, não como compra." },
];

export default function ClientMailSetup({ clientId }: { clientId: string }) {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [base, setBase] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pattern, setPattern] = useState("");
  const [mode, setMode] = useState<"allow" | "block">("allow");
  const [global, setGlobal] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([
      fetch(`/api/clients/${clientId}/mail-routes`, { cache: "no-store" }),
      fetch(`/api/clients/${clientId}/mail-senders`, { cache: "no-store" }),
    ]);
    const rd = await r.json();
    setRoutes(rd.routes || []);
    setBase(rd.inbox_address ?? null);
    setConfigured(Boolean(rd.configured));
    setSenders((await s.json()).senders || []);
    setLoading(false);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const addressFor = (token: string) => {
    if (!base) return null;
    const at = base.lastIndexOf("@");
    if (at <= 0) return null;
    return `${base.slice(0, at)}+${token}${base.slice(at)}`;
  };

  async function createRoute(direction: "purchase" | "sale") {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/mail-routes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      const d = await res.json();
      setMsg(res.ok ? { text: "Endereço criado." } : { text: d.error || "Erro.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function patchRoute(id: string, body: any, message: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/mail-routes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json();
      setMsg(res.ok ? { text: message } : { text: d.error || "Erro.", error: true });
      await load();
    } finally { setBusy(false); }
  }

  async function addSender() {
    if (!pattern.trim()) { setMsg({ text: "Escreva o endereço ou o domínio.", error: true }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/mail-senders`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern, mode, global }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ text: d.error || "Erro.", error: true }); return; }
      setPattern(""); setMsg({ text: mode === "allow" ? "Remetente liberado." : "Remetente bloqueado." });
      await load();
    } finally { setBusy(false); }
  }

  async function removeSender(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/clients/${clientId}/mail-senders/${id}`, { method: "DELETE" });
      await load();
    } finally { setBusy(false); }
  }

  const allows = senders.filter((s) => s.mode === "allow");
  const blocks = senders.filter((s) => s.mode === "block");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Entrada por e-mail</h2>
        <p className="mt-0.5 text-sm text-muted">
          Um endereço por cliente e por direção. Pode ser dado <strong>direto ao fornecedor</strong> — aí a
          fatura chega sozinha na <Link href="/inbox" className="text-brand-700">caixa de entrada</Link> e o
          cliente não faz nada.
        </p>
      </div>

      {!configured && (
        <div className="card border border-warning/30 bg-warning-50 p-4 text-sm text-warning">
          A busca de e-mail ainda não está ligada no servidor. Os endereços abaixo podem ser criados desde já,
          mas nada será buscado até o ambiente ter <code className="font-mono">MAIL_IMAP_*</code> configurado.
        </div>
      )}

      <div className="space-y-3">
        {DIRECTIONS.map((d) => {
          const route = routes.find((r) => r.direction === d.v);
          const address = route ? addressFor(route.token) : null;
          return (
            <div key={d.v} className={`card p-4 ${route && !route.active ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{d.label}</p>
                  <p className="mt-0.5 text-sm text-muted">{d.hint}</p>
                  {route && (
                    <p className="mt-2 break-all font-mono text-sm">
                      {address ?? (
                        <span className="text-muted">
                          token <strong>{route.token}</strong> — o endereço base vem do ambiente
                          (<code>MAIL_INBOX_ADDRESS</code>) e ainda não está configurado
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!route ? (
                    <button className="btn-primary h-9 px-4 text-sm" disabled={busy}
                      onClick={() => createRoute(d.v)}>Criar endereço</button>
                  ) : (
                    <>
                      {address && (
                        <button className="btn-ghost h-9 px-3 text-sm"
                          onClick={() => { navigator.clipboard?.writeText(address); setMsg({ text: "Endereço copiado." }); }}>
                          Copiar
                        </button>
                      )}
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input type="checkbox" checked={route.active} disabled={busy}
                          onChange={(e) => patchRoute(route.id, { active: e.target.checked },
                            e.target.checked ? "Endereço ligado." : "Endereço desligado — o que chegar nele será recusado.")} />
                        ativo
                      </label>
                      <button className="btn-ghost h-9 px-3 text-sm" disabled={busy}
                        onClick={() => {
                          if (!confirm("Trocar o endereço? O antigo para de funcionar na hora, e quem já tem o antigo (fornecedor, pedido impresso) precisa receber o novo.")) return;
                          patchRoute(route.id, { rotate: true }, "Endereço trocado. Avise quem usava o antigo.");
                        }}>
                        Trocar
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted">
        O pedaço depois do <span className="font-mono">+</span> é aleatório de propósito. Um endereço como
        <span className="font-mono"> notas+c0001@</span> contaria quantos clientes o escritório tem e deixaria
        adivinhar o endereço do vizinho — e esse endereço vai para as mãos de fornecedores.
        <strong> Trocar</strong> é o conserto de quando o endereço vaza para lista de spam: melhor que desligar a
        entrada do cliente inteiro.
      </p>

      <div className="card p-4">
        <p className="label mb-2">Quem pode mandar</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_150px_auto]">
          <input className="input" placeholder="ap@fornecedor.ie ou @fornecedor.ie"
            value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as "allow" | "block")}>
            <option value="allow">liberar</option>
            <option value="block">bloquear</option>
          </select>
          <button className="btn-primary" onClick={addSender} disabled={busy}>Adicionar</button>
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
          valer para <strong>todos os clientes</strong> do escritório (um domínio de spam não precisa ser
          bloqueado vinte vezes)
        </label>

        <div className="mt-3 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-muted">
          <strong>Bloqueio ganha da liberação:</strong> quem bloqueia um remetente está corrigindo algo que já
          aconteceu, e uma liberação ampla escrita meses antes não pode desfazer isso em silêncio.
          <br />
          <strong>Nenhuma liberação = caixa aberta.</strong> Enquanto a lista de liberação estiver vazia,
          qualquer remetente que não esteja bloqueado passa — quem ligou a entrada por e-mail e ainda não
          cadastrou ninguém quer receber, não recusar tudo.
          {allows.length > 0 && (
            <>
              <br />
              <strong className="text-warning">
                A lista de liberação está preenchida, então só estes {allows.length} passam.
              </strong>
            </>
          )}
        </div>

        {loading ? (
          <p className="mt-3 text-sm text-muted">Carregando…</p>
        ) : !senders.length ? (
          <p className="mt-3 text-sm text-muted">Nenhum remetente cadastrado — a caixa deste cliente está aberta.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {[{ list: allows, title: "Liberados (só estes passam)" }, { list: blocks, title: "Bloqueados" }]
              .filter((g) => g.list.length)
              .map((g) => (
                <div key={g.title}>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted">{g.title}</p>
                  <div className="divide-y divide-line/70 rounded-lg border border-line">
                    {g.list.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                        <span className="font-mono">{s.pattern}</span>
                        {s.client_id == null && (
                          <span className="chip bg-surface-2 border border-line text-muted">todos os clientes</span>
                        )}
                        {s.note && <span className="text-xs text-muted">{s.note}</span>}
                        <button className="ml-auto text-xs text-danger underline underline-offset-2"
                          disabled={busy} onClick={() => removeSender(s.id)}>
                          remover
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {msg && <p className={`mt-3 text-sm ${msg.error ? "text-danger" : "text-brand-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
