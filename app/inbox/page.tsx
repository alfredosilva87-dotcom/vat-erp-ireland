"use client";

/**
 * A caixa de entrada (camada B2).
 *
 * O que chegou por e-mail, esperando o escritório. A leitura e a gravação passam
 * pelo mesmo caminho da tela de leitura (`lib/ingestFlow.ts`), de propósito: a
 * nota que entrou por e-mail não pode ser gravada por um caminho diferente da
 * que entrou arrastada, senão a regra de fornecedor, o anti-duplicata e o
 * cálculo de crédito valeriam numa porta e não na outra.
 *
 * O item que **não** entrou aparece aqui do mesmo jeito, com o motivo escrito.
 * E-mail que some em silêncio é o que faz um escritório deixar de confiar na
 * entrada automática e voltar a pedir os PDFs por WhatsApp.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { base64ToFile, mergeIntoExisting, readDocumentFile, saveDocument, type DuplicateMatch, type IngestDocument } from "@/lib/ingestFlow";
import { computeLines } from "@/lib/vat";
import { useT } from "@/lib/i18n";

type Client = {
  id: string; name: string; client_code: string; activity_code: string;
  default_credit_unmatched: boolean; related_categories: string[];
};
type Item = {
  id: string; client_id: string | null; direction: "purchase" | "sale" | null;
  sender: string | null; subject: string | null; body: string | null;
  received_at: string | null; filename: string | null; mime_type: string | null;
  size_bytes: number | null; status: string; refused_reason: string | null;
  invoice_id: string | null; invoice_count: number; created_at: string;
};
type FetchLog = {
  id: string; mailbox: string | null; seen_count: number; accepted_count: number;
  refused_count: number; duplicate_count: number; error: string | null;
  started_at: string; finished_at: string | null;
};
/** O que a tela guarda sobre um item enquanto ele é lido e gravado. */
type Work = {
  busy?: boolean;
  docs?: IngestDocument[];
  files?: File[];
  error?: string;
  savedIds?: string[];
  duplicate?: DuplicateMatch | null;
};

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kb = (n: number | null) => (n == null ? "—" : `${Math.max(1, Math.round(n / 1024))} KB`);
const day = (s: string | null) => (s ? s.slice(0, 10) : "—");

const docCredit = (doc: IngestDocument) => {
  const { lines } = computeLines(doc.items, {
    total_net: doc.header.total_net, total_vat: doc.header.total_vat, total_gross: doc.header.total_gross,
  });
  return doc.items.reduce((a, it, i) => a + (it.take_credit ? lines[i].vat : 0), 0);
};

export default function Inbox() {
  const { t } = useT();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [branches, setBranches] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Item[]>([]);
  const [work, setWork] = useState<Record<string, Work>>({});
  const [fetches, setFetches] = useState<FetchLog[]>([]);
  const [config, setConfig] = useState<{ configured: boolean; missing: string[]; inbox_address: string | null; mailbox: string | null } | null>(null);
  // A entrada por telefone (camada B4) é independente da de e-mail: o escritório
  // pode ter uma, a outra, ou as duas. O aviso amarelo de e-mail desligado não
  // pode fazer parecer que a fila inteira está parada quando o telefone entrega.
  const [phoneConfigured, setPhoneConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    const status = showDone ? "" : "pending,read,refused,duplicate";
    const qs = new URLSearchParams();
    if (clientId) qs.set("client", clientId);
    if (status) qs.set("status", status);
    const [i, f, p] = await Promise.all([
      fetch(`/api/mail/inbox?${qs}`, { cache: "no-store" }),
      fetch("/api/mail/fetch", { cache: "no-store" }),
      fetch("/api/phone/fetch", { cache: "no-store" }).catch(() => null),
    ]);
    setItems((await i.json()).items || []);
    const fd = await f.json();
    setConfig({ configured: fd.configured, missing: fd.missing || [], inbox_address: fd.inbox_address, mailbox: fd.mailbox });
    setFetches(fd.fetches || []);
    const pd = p ? await p.json().catch(() => null) : null;
    setPhoneConfigured(Boolean(pd?.configured));
    setLoading(false);
  }, [clientId, showDone]);

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json()).then((d) => setClients(d.clients || []));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setBranchId("");
    if (!clientId) { setBranches([]); return; }
    fetch(`/api/clients/${clientId}/branches`).then((r) => r.json()).then((d) => setBranches(d.branches || []));
  }, [clientId]);

  const selected = clients.find((c) => c.id === clientId);
  // Mesma regra da tela de leitura: uma vez que o cliente tem filiais, toda
  // gravação tem de estar amarrada a uma, senão a nota cai sem loja e ninguém
  // percebe até o fechamento.
  const branchRequired = branches.length > 0;
  const canSave = Boolean(clientId) && (!branchRequired || Boolean(branchId));

  async function runFetch() {
    setFetching(true); setMsg(null);
    try {
      // As DUAS portas na mesma volta. Duas buscas separadas fariam o escritório
      // ter que lembrar qual botão traz a foto do telefone e qual traz o e-mail —
      // e a fila é uma só, então o gesto também deve ser um.
      const phone = phoneConfigured
        ? await fetch("/api/phone/fetch", { method: "POST" }).then((r) => r.json()).catch(() => null)
        : null;

      if (!config?.configured) {
        // Só telefone configurado: sem isto, a volta terminaria sem dizer nada e
        // pareceria que o botão não funciona.
        const parts = phone
          ? [t("inbox.msgPhone", { n: String(phone.ingested ?? 0) })]
          : [t("inbox.empty")];
        if (phone?.duplicates) parts.push(t("inbox.msgAlready", { n: phone.duplicates }));
        if (phone?.failed) parts.push(t("inbox.msgPhoneFailed", { n: phone.failed }));
        setMsg({ text: parts.join(" · "), error: Boolean(phone?.error) });
        await load();
        return;
      }

      const res = await fetch("/api/mail/fetch", { method: "POST" });
      const d = await res.json();
      if (d.error) {
        setMsg({ text: d.error, error: true });
      } else {
        const parts = [t("inbox.msgRead", { n: d.seen }), t("inbox.msgQueued", { n: d.accepted })];
        if (d.duplicate) parts.push(t("inbox.msgAlready", { n: d.duplicate }));
        if (d.refused) parts.push(t("inbox.msgRefused", { n: d.refused }));
        // O que ficou para a próxima é DITO. Silêncio aqui leria como
        // "chegou tudo", e o escritório fecharia o mês sem as notas que sobraram.
        if (d.remaining) parts.push(t("inbox.msgRemaining", { n: d.remaining }));
        if (phone && (phone.ingested || phone.failed)) {
          parts.push(t("inbox.msgPhone", { n: String(phone.ingested ?? 0) }));
          if (phone.failed) parts.push(t("inbox.msgPhoneFailed", { n: phone.failed }));
        }
        setMsg({ text: parts.join(" · ") });
      }
      await load();
    } finally { setFetching(false); }
  }

  function setW(id: string, patch: Work) {
    setWork((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function readItem(item: Item) {
    if (!selected) return;
    setW(item.id, { busy: true, error: undefined });
    try {
      const res = await fetch(`/api/mail/inbox/${item.id}/file`, { cache: "no-store" });
      if (!res.ok) throw new Error(t("inbox.downloadFailed"));
      const blob = await res.blob();
      const file = new File([blob], item.filename || "anexo", { type: item.mime_type || blob.type });
      const docs = await readDocumentFile(file, {
        clientId: selected.id,
        activityCode: selected.activity_code || "GENERIC",
        defaultCreditUnmatched: selected.default_credit_unmatched,
        relatedCategories: selected.related_categories ?? [],
      });
      // Um anexo pode trazer várias notas dentro (PDF com o lote do mês). Cada
      // uma vira um arquivo próprio, como na tela de leitura.
      const files = docs.map((d) => (d.pdf_base64 ? base64ToFile(d.pdf_base64, d.filename) : file));
      setW(item.id, { busy: false, docs, files });
      await fetch(`/api/mail/inbox/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "read" }),
      });
    } catch (e: any) {
      setW(item.id, { busy: false, error: e.message });
    }
  }

  async function saveItem(item: Item, force = false) {
    const w = work[item.id];
    if (!w?.docs?.length || !w.files?.length || !canSave) return;
    setW(item.id, { busy: true, error: undefined, duplicate: undefined });
    try {
      const ids: string[] = [];
      let dup: DuplicateMatch | null | undefined;
      for (let i = 0; i < w.docs.length; i++) {
        const out = await saveDocument(w.files[i], w.docs[i], {
          clientId, branchId, activityCode: selected?.activity_code || "GENERIC", postingDate, force,
        });
        if (out.kind === "duplicate") { dup = out.existing; continue; }
        ids.push(out.id);
      }
      if (ids.length) {
        await fetch(`/api/mail/inbox/${item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "saved", invoice_id: ids[0], invoice_count: ids.length }),
        });
      } else if (dup !== undefined) {
        await fetch(`/api/mail/inbox/${item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "duplicate" }),
        });
      }
      setW(item.id, { busy: false, savedIds: ids, duplicate: dup ?? null });
      await load();
    } catch (e: any) {
      setW(item.id, { busy: false, error: e.message });
    }
  }

  /**
   * Junta o anexo desta duplicata ao lançamento que já existe (camada B3).
   *
   * O item da fila fica marcado como duplicata resolvida: a imagem não se perde e
   * não nasce um segundo lançamento com o mesmo dinheiro.
   */
  async function mergeItem(item: Item) {
    const w = work[item.id];
    if (!w?.duplicate) return;
    setW(item.id, { busy: true, error: undefined });
    try {
      const res = await fetch(`/api/mail/inbox/${item.id}/file`, { cache: "no-store" });
      const blob = await res.blob();
      const file = new File([blob], item.filename || "anexo", { type: item.mime_type || blob.type });
      const out = await mergeIntoExisting(file, w.duplicate.id, item.filename || undefined);
      if (!out.ok) { setW(item.id, { busy: false, error: out.error }); return; }
      await fetch(`/api/mail/inbox/${item.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "duplicate", invoice_id: w.duplicate.id }),
      });
      setW(item.id, { busy: false, duplicate: null });
      setMsg({ text: t("inbox.merged") });
      await load();
    } catch (e: any) {
      setW(item.id, { busy: false, error: e.message });
    }
  }

  async function discard(item: Item) {
    if (!confirm(t("inbox.discardConfirm"))) return;
    const res = await fetch(`/api/mail/inbox/${item.id}`, { method: "DELETE" });
    if (!res.ok) { const d = await res.json(); setMsg({ text: d.error, error: true }); return; }
    await load();
  }

  const pending = items.filter((i) => i.status === "pending").length;
  const refused = items.filter((i) => i.status === "refused").length;

  return (
    <div className="space-y-6">
      <div className="rise">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{t("inbox.title")}</h1>
        <p className="mt-1 text-muted">{t("inbox.subtitle")}</p>
      </div>

      {config && !config.configured && !phoneConfigured && (
        <div className="card rise border border-warning/30 bg-warning-50 p-5 text-sm text-warning">
          <p className="font-medium">{t("inbox.notConfigured")}</p>
          <p className="mt-1">
            {t("inbox.missingEnv")} <code className="font-mono">{config.missing.join(", ")}</code>{" "}
            {t("inbox.passwordFromEnv")}
          </p>
        </div>
      )}

      <div className="card rise p-5">
        <div className="grid gap-5 sm:grid-cols-[260px_1fr]">
          <div>
            <label className="label" htmlFor="client">{t("analyze.client")}</label>
            <select id="client" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{t("inbox.allClients")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.client_code} · {c.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted">{t("inbox.clientHelp")}</p>

            <label className="label mt-4" htmlFor="posting">{t("analyze.postingDate")}</label>
            <input id="posting" type="date" className="input" value={postingDate}
              onChange={(e) => setPostingDate(e.target.value)} />

            {branchRequired && (
              <>
                <label className="label mt-4" htmlFor="branch">{t("analyze.branch")}</label>
                <select id="branch" className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  <option value="">{t("inbox.pickBranch")}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.code ? `${b.code} · ` : ""}{b.name}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-3">
              <button className="btn-primary" onClick={runFetch} disabled={fetching || (!config?.configured && !phoneConfigured)}>
                {fetching ? t("inbox.fetching") : t("inbox.fetchNow")}
              </button>
              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
                {t("inbox.showDone")}
              </label>
              <div className="ml-auto flex gap-2 text-sm">
                {pending > 0 && <span className="chip bg-brand text-white">{t("inbox.waitingCount", { n: pending })}</span>}
                {refused > 0 && <span className="chip-warn">{t("inbox.refusedCount", { n: refused })}</span>}
              </div>
            </div>
            {msg && (
              <p className={`mt-3 text-sm ${msg.error ? "text-danger" : "text-brand-700"}`}>{msg.text}</p>
            )}
            {config?.inbox_address && (
              <p className="mt-3 text-xs text-muted">
                {t("inbox.mailboxLine", { address: "" })}<span className="font-mono">{config.inbox_address}</span>
                {config.mailbox ? t("inbox.folderLine", { folder: config.mailbox }) : ""}.{" "}
                {t("inbox.addressPerClient")}
              </p>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <p className="card p-6 text-muted">{t("common.loading")}</p>
      ) : !items.length ? (
        <p className="card p-6 text-muted">
          {t("inbox.empty")} {config?.configured || phoneConfigured ? t("inbox.emptyHint") : ""}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <InboxCard
              key={item.id} item={item} work={work[item.id]} clients={clients}
              canRead={Boolean(clientId) && item.client_id === clientId}
              canSave={canSave}
              onRead={() => readItem(item)} onSave={(force) => saveItem(item, force)}
              onMerge={() => mergeItem(item)} onDiscard={() => discard(item)}
            />
          ))}
        </div>
      )}

      {!!fetches.length && (
        <div className="card overflow-hidden rise">
          <p className="border-b border-line bg-surface-2/60 px-4 py-2.5 text-xs uppercase tracking-wide text-muted">
            {t("inbox.fetchesTitle")}
          </p>
          <div className="divide-y divide-line/70 text-sm">
            {fetches.slice(0, 8).map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                <span className="tnum text-muted">{f.started_at.slice(0, 16).replace("T", " ")}</span>
                <span>{t("inbox.fetchRead", { n: f.seen_count })}</span>
                <span className="text-brand-700">{t("inbox.fetchQueued", { n: f.accepted_count })}</span>
                {f.duplicate_count > 0 && <span className="text-muted">{t("inbox.fetchRepeated", { n: f.duplicate_count })}</span>}
                {f.refused_count > 0 && <span className="text-warning">{t("inbox.fetchRefused", { n: f.refused_count })}</span>}
                {f.error && <span className="text-danger">{f.error}</span>}
                {!f.finished_at && <span className="text-muted">{t("inbox.fetchRunning")}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InboxCard({
  item, work, clients, canRead, canSave, onRead, onSave, onMerge, onDiscard,
}: {
  item: Item; work: Work | undefined; clients: Client[];
  canRead: boolean; canSave: boolean;
  onRead: () => void; onSave: (force?: boolean) => void; onMerge: () => void; onDiscard: () => void;
}) {
  const { t } = useT();
  const client = clients.find((c) => c.id === item.client_id);
  const docs = work?.docs ?? [];

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {item.filename || t("inbox.noAttachment")}
            {item.size_bytes ? <span className="ml-2 text-xs font-normal text-muted">{kb(item.size_bytes)}</span> : null}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {item.sender || t("inbox.noSender")} · {day(item.received_at || item.created_at)}
            {client ? ` · ${client.client_code} ${client.name}` : ` · ${t("inbox.noClient")}`}
            {item.direction ? ` · ${item.direction === "sale" ? t("inbox.sale") : t("inbox.purchase")}` : ""}
          </p>
          {item.subject && <p className="mt-0.5 truncate text-sm">{item.subject}</p>}
        </div>
        <StatusChip item={item} savedIds={work?.savedIds} />
      </div>

      {item.body && (
        <p className="mt-3 whitespace-pre-line rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-muted">
          {item.body}
        </p>
      )}

      {item.status === "refused" && item.refused_reason && (
        <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning">
          {t("inbox.didNotEnter", { reason: item.refused_reason })}
        </p>
      )}

      {work?.error && <p className="mt-3 text-sm text-danger">{work.error}</p>}

      {!!docs.length && (
        <div className="mt-3 space-y-2">
          {docs.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line px-3 py-2 text-sm">
              <span className="font-medium">{d.header.supplier_name || t("inbox.supplierNotRead")}</span>
              <span className="tnum text-muted">{d.header.invoice_date || t("inbox.noDate")}</span>
              <span className="tnum">€ {money(d.header.total_gross)}</span>
              <span className="tnum text-brand-700">{t("inbox.creditLabel")} € {money(docCredit(d))}</span>
              {d.supplier_rule && (
                <span className="chip bg-brand-50 text-brand-700">
                  {d.supplier_rule.label}{d.supplier_rule.line_items_off ? " · 1 linha" : ""}
                </span>
              )}
              {d.needs_review && (
                <span className="chip-warn" title={d.issues.join("; ")}>{t("inbox.reviewChip")}</span>
              )}
              <span className="ml-auto text-xs text-muted">{t("inbox.linesCount", { n: d.items.length })}</span>
            </div>
          ))}
          {docs.length > 1 && (
            <p className="text-xs text-muted">
              {t("inbox.splitNote", { n: docs.length })}
            </p>
          )}
        </div>
      )}

      {work?.duplicate !== undefined && work.duplicate && (
        <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning">
          {t("inbox.dupExists", {
            number: work.duplicate.invoice_number || t("inbox.dupNoNumber"),
            date: work.duplicate.posting_date || t("inbox.noDate"),
          })}{" "}
          <Link href={`/invoice/${work.duplicate.id}`} className="underline">{t("inbox.dupOpen")}</Link>,{" "}
          <button className="underline" onClick={onMerge}>{t("inbox.dupMerge")}</button>{" "}
          <button className="underline" onClick={() => onSave(true)}>{t("inbox.dupSaveAnyway")}</button>.
          <span className="mt-1 block text-xs">{t("inbox.dupMergeHelp")}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(item.status === "pending" || item.status === "read") && item.client_id && (
          <>
            {!docs.length ? (
              <button className="btn-primary h-9 px-4 text-sm" onClick={onRead} disabled={work?.busy || !canRead}>
                {work?.busy ? t("inbox.reading") : t("inbox.read")}
              </button>
            ) : (
              <button className="btn-primary h-9 px-4 text-sm" onClick={() => onSave(false)} disabled={work?.busy || !canSave}>
                {work?.busy ? t("inbox.saving") : t("inbox.save", { n: docs.length })}
              </button>
            )}
          </>
        )}
        {item.status !== "saved" && (
          <button className="btn-ghost ml-auto h-9 px-3 text-sm text-danger" onClick={onDiscard} disabled={work?.busy}>
            {t("inbox.discard")}
          </button>
        )}
        {item.status === "saved" && item.invoice_id && (
          <Link className="btn-ghost ml-auto h-9 px-3 text-sm" href={`/invoice/${item.invoice_id}`}>
            {t("inbox.openInvoice")}
          </Link>
        )}
      </div>

      {!canRead && (item.status === "pending" || item.status === "read") && item.client_id && (
        <p className="mt-2 text-xs text-muted">
          {t("inbox.pickClientToRead", { client: client ? `${client.client_code} · ${client.name}` : t("inbox.thisItemsClient") })}
        </p>
      )}
      {!item.client_id && item.status === "refused" && (
        <p className="mt-2 text-xs text-muted">
          {t("inbox.noClientNoRead")}
        </p>
      )}
    </div>
  );
}

function StatusChip({ item, savedIds }: { item: Item; savedIds?: string[] }) {
  const { t } = useT();
  if (item.status === "saved" || savedIds?.length) {
    const n = item.invoice_count || savedIds?.length || 1;
    return <span className="chip-ok">{n > 1 ? t("inbox.stSavedMany", { n }) : t("inbox.stSaved")}</span>;
  }
  if (item.status === "duplicate") return <span className="chip-warn">{t("inbox.stDuplicate")}</span>;
  if (item.status === "refused") return <span className="chip-warn">{t("inbox.stRefused")}</span>;
  if (item.status === "read") return <span className="chip bg-surface-2 border border-line text-muted">{t("inbox.stRead")}</span>;
  if (item.status === "discarded") return <span className="chip bg-surface-2 border border-line text-muted">{t("inbox.stDiscarded")}</span>;
  return <span className="chip bg-brand-50 text-brand-700">{t("inbox.stWaiting")}</span>;
}

