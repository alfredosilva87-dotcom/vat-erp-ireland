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
 *
 * `lockedClientId` (de dentro do módulo Compras de um cliente) trava o filtro
 * nele — o que aparece então é só o que já foi roteado para esse cliente,
 * porque a API só devolve item sem dono (client_id nulo) quando NENHUM filtro
 * de cliente é passado. A fila de "ainda sem dono" continua só na tela geral
 * (`/inbox`), de propósito: decidir de quem é um documento é uma pergunta
 * entre clientes, não de um cliente só.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { base64ToFile, mergeIntoExisting, readDocumentFile, saveDocument, saveSaleDocument, type DuplicateMatch, type IngestDocument } from "@/lib/ingestFlow";
import { computeLines } from "@/lib/vat";
import { useT } from "@/lib/i18n";
import { originLabelKey } from "@/lib/origin";

type Client = {
  id: string; name: string; client_code: string; activity_code: string;
  default_credit_unmatched: boolean; related_categories: string[];
};
type Item = {
  id: string; client_id: string | null; direction: "purchase" | "sale" | null;
  /** "email" (caixa do escritório, B2) ou "phone" (app de passagem, B4). */
  source: string;
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

/**
 * Data E HORA de quando o documento entrou.
 *
 * A hora não é enfeite: quando o cliente manda a mesma nota duas vezes no
 * mesmo dia, ou quando se quer saber se a foto chegou antes ou depois do
 * fechamento, a data sozinha não responde. Formatada no fuso de quem olha,
 * porque o carimbo vem em UTC do banco.
 */
const stamp = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
};

/** Como cada classificação aparece. `null` = nada a dizer (nota normal). */
const KIND_LABEL: Record<string, { text: string; junk: boolean } | undefined> = {
  sales_sheet: { text: "planilha de vendas", junk: false },
  receipt: { text: "recibo", junk: false },
  illegible: { text: "ilegível", junk: true },
  not_a_document: { text: "não é documento", junk: true },
};

const docCredit = (doc: IngestDocument) => {
  const { lines } = computeLines(doc.items, {
    total_net: doc.header.total_net, total_vat: doc.header.total_vat, total_gross: doc.header.total_gross,
  });
  return doc.items.reduce((a, it, i) => a + (it.take_credit ? lines[i].vat : 0), 0);
};

// Mesma ideia da tela de Analisar: ler em paralelo, um pool pequeno, gravar
// continua manual (por item) — o lote só poupa o "abrir um por um" da leitura.
const READ_CONCURRENCY = 4;

export default function InboxView({ lockedClientId }: { lockedClientId?: string } = {}) {
  const { t } = useT();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState(lockedClientId || "");
  const [branches, setBranches] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<Item[]>([]);
  const [work, setWork] = useState<Record<string, Work>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [discardingSelected, setDiscardingSelected] = useState(false);
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
  const [bulkPhase, setBulkPhase] = useState<"idle" | "reading" | "saving">("idle");
  const [bulkTotal, setBulkTotal] = useState(0);
  const [bulkDone, setBulkDone] = useState(0);

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
    fetch("/api/clients", { cache: "no-store" }).then((r) => r.json()).then((d) => setClients(d.clients || []));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Seleção presa a uma tela desatualizada apagaria item que a pessoa nem viu
  // mais — mesma regra do "selected" na tela de Lançamentos.
  useEffect(() => { setSelectedIds(new Set()); }, [items]);

  useEffect(() => {
    setBranchId("");
    if (!clientId) { setBranches([]); return; }
    fetch(`/api/clients/${clientId}/branches`, { cache: "no-store" }).then((r) => r.json()).then((d) => setBranches(d.branches || []));
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

  /** "Ler tudo" — a etapa de leitura em fila, mesma ideia da tela de Analisar. */
  async function readAllVisible() {
    const queue = items.filter((item) =>
      Boolean(clientId) && item.client_id === clientId &&
      (item.status === "pending" || item.status === "read" || item.status === "duplicate") &&
      !(work[item.id]?.docs?.length)
    );
    if (!queue.length) return;
    setBulkPhase("reading"); setBulkTotal(queue.length); setBulkDone(0);
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        // readItem() nunca lança pra fora (o try/catch dela grava o erro no
        // próprio item) — um documento sem número de nota, ou qualquer outra
        // falha de leitura, vira "erro" naquele card e o lote segue os
        // outros, em vez de travar tudo por causa de um.
        await readItem(item);
        setBulkDone((d) => d + 1);
      }
    }
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, queue.length) }, worker));
    setBulkPhase("idle");
  }

  /**
   * "Gravar tudo" — sequencial de propósito (mesma razão do saveAll() da tela
   * de Analisar: cada gravação passa por um select-then-insert em
   * items_master com índice único, e duas gravações concorrentes disputando a
   * mesma descrição de item colidem nessa restrição).
   *
   * Nunca força: cada item que bate em documento igual já lançado vira
   * "duplicata" no próprio card (mesmo caminho do botão individual), pra
   * decidir juntar ou gravar mesmo assim continuar sendo escolha de quem está
   * revisando — o lote não pode silenciosamente duplicar um lançamento.
   */
  async function saveAllVisible() {
    const queue = items.filter((item) =>
      Boolean(clientId) && item.client_id === clientId &&
      (item.status === "pending" || item.status === "read") &&
      (work[item.id]?.docs?.length) && !(work[item.id]?.duplicate) &&
      // Sujeira fica de fora do lote: gravar em massa é justamente onde uma
      // foto ilegível passaria sem ninguém olhar.
      !isJunk(item.id) && !isSheetDoc(item.id)
    );
    if (!queue.length || !canSave) return;
    setBulkPhase("saving"); setBulkTotal(queue.length); setBulkDone(0);
    for (const item of queue) {
      await saveItem(item);
      setBulkDone((d) => d + 1);
    }
    setBulkPhase("idle");
  }

  async function saveItem(item: Item, force = false) {
    const w = work[item.id];
    if (!w?.docs?.length || !w.files?.length || !canSave) return;
    setW(item.id, { busy: true, error: undefined, duplicate: undefined });

    /*
     * VENDA vai para a tabela de vendas, não para as notas de entrada.
     *
     * A fila sabe a direção desde a camada B2, e o link de telefone (B4) deixa
     * o cliente marcar "venda" — mas a gravação mandava tudo para `invoices`.
     * Uma venda gravada como compra troca o IVA de lado: some do débito (T1) e
     * ainda abate no crédito (T2), errando o VAT3 nos dois sentidos.
     */
    if (item.direction === "sale") {
      try {
        let count = 0;
        // Um PDF com VÁRIAS notas de venda já chega aqui dividido: a leitura
        // (readDocuments) reconhece os limites e devolve um documento por
        // nota, com o PDF recortado de cada uma — o mesmo caminho da entrada.
        for (let i = 0; i < w.docs.length; i++) {
          const out = await saveSaleDocument(w.files[i], w.docs[i], {
            clientId, postingDate, source: item.source || "email",
            capturedAt: item.received_at || item.created_at,
          });
          if (out.kind === "error") { setW(item.id, { busy: false, error: out.error }); return; }
          count += 1;
        }
        await fetch(`/api/mail/inbox/${item.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "saved", invoice_count: count }),
        });
        setW(item.id, { busy: false, savedIds: [] });
        setMsg({ text: t("inbox.savedAsSale", { n: String(count) }) });
        await load();
      } catch (e: any) {
        setW(item.id, { busy: false, error: e.message });
      }
      return;
    }

    try {
      const ids: string[] = [];
      let dup: DuplicateMatch | null | undefined;
      for (let i = 0; i < w.docs.length; i++) {
        const out = await saveDocument(w.files[i], w.docs[i], {
          clientId, branchId, activityCode: selected?.activity_code || "GENERIC", postingDate, force,
          // A origem do item da fila segue para a nota: "email" ou "phone".
          source: item.source || "email",
          // O carimbo de chegada da FILA, não o de agora: o e-mail de sábado
          // lançado na segunda tem de registrar sábado.
          capturedAt: item.received_at || item.created_at,
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

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const discardableItems = items.filter((i) => i.status !== "saved");
  const allSelected = discardableItems.length > 0 && discardableItems.every((i) => selectedIds.has(i.id));
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(discardableItems.map((i) => i.id)));
  }

  /**
   * "Descartar selecionadas" — apaga cada item em sequência (não é dado
   * frequente o bastante pra valer uma rota de lote como a de notas), pulando
   * o que virar "saved" nesse meio-tempo (mesmo guard do descarte individual:
   * item já virado nota não some por aqui, se apaga a nota).
   */
  async function discardSelected() {
    const ids = Array.from(selectedIds).filter((id) => items.find((i) => i.id === id)?.status !== "saved");
    if (!ids.length) return;
    if (!confirm(t("inbox.discardSelectedConfirm", { n: String(ids.length) }))) return;
    setDiscardingSelected(true);
    let failed = 0;
    for (const id of ids) {
      const res = await fetch(`/api/mail/inbox/${id}`, { method: "DELETE" });
      if (!res.ok) failed++;
    }
    setSelectedIds(new Set());
    setDiscardingSelected(false);
    if (failed) setMsg({ text: t("inbox.discardSelectedPartial", { n: String(failed) }), error: true });
    await load();
  }

  // IDs gravados nesta sessão de tela (lote de leitura/gravação em andamento
  // ou recém-terminado) — dá pra "Revisar este lote" sem sair do módulo.
  const sessionSavedIds = Object.values(work).flatMap((w) => w.savedIds ?? []);
  const pending = items.filter((i) => i.status === "pending").length;
  const refused = items.filter((i) => i.status === "refused").length;
  const readableCount = items.filter((item) =>
    Boolean(clientId) && item.client_id === clientId &&
    (item.status === "pending" || item.status === "read" || item.status === "duplicate") &&
    !(work[item.id]?.docs?.length)
  ).length;
  /** Sujeira reconhecida na leitura: não entra em lote de gravação. */
  const isJunk = (id: string) => {
    const k = work[id]?.docs?.[0]?.header?.doc_kind;
    return k === "illegible" || k === "not_a_document";
  };
  /**
   * Planilha também fica de fora do lote — pelo outro motivo: não é lixo, é
   * documento bom lido pelo leitor errado. Gravar aqui daria UMA venda com o
   * total da folha, um número que fecha e está errado. Vai pelo leitor de
   * planilha, em Vendas.
   */
  const isSheetDoc = (id: string) => work[id]?.docs?.[0]?.header?.doc_kind === "sales_sheet";
  const saveableCount = items.filter((item) =>
    Boolean(clientId) && item.client_id === clientId &&
    (item.status === "pending" || item.status === "read") &&
    (work[item.id]?.docs?.length) && !(work[item.id]?.duplicate) && !isJunk(item.id) && !isSheetDoc(item.id)
  ).length;
  const junkIds = items.filter((i) => i.status !== "saved" && isJunk(i.id)).map((i) => i.id);
  const bulkBusy = bulkPhase !== "idle";
  const bulkPct = bulkTotal ? Math.round((bulkDone / bulkTotal) * 100) : 0;

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

      {sessionSavedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/40 bg-brand-50 px-4 py-2.5 text-sm">
          {t("inbox.batchSaved", { n: String(sessionSavedIds.length) })}
          <Link
            className="btn-ghost ml-auto h-8 px-3 text-xs"
            href={lockedClientId ? `/clients/${lockedClientId}/purchases?ids=${sessionSavedIds.join(",")}` : `/records?ids=${sessionSavedIds.join(",")}`}
          >
            {t("inbox.reviewBatch")}
          </Link>
        </div>
      )}

      <div className="card rise p-5">
        <div className="grid gap-5 sm:grid-cols-[260px_1fr]">
          <div>
            <label className="label" htmlFor="client">{t("analyze.client")}</label>
            <select id="client" className="input" value={clientId} disabled={!!lockedClientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">{t("inbox.allClients")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.client_code} · {c.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted">
              {lockedClientId ? t("inbox.lockedClientHelp") : t("inbox.clientHelp")}
            </p>

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
              <button
                className="btn-ghost"
                onClick={readAllVisible}
                disabled={bulkBusy || !readableCount}
                title={!clientId ? t("inbox.readAllNeedsClient") : undefined}
              >
                {bulkPhase === "reading" ? t("inbox.readingAll") : `${t("inbox.readAll")} (${readableCount})`}
              </button>
              <button
                className="btn-ghost"
                onClick={saveAllVisible}
                disabled={bulkBusy || !saveableCount || !canSave}
                title={!clientId ? t("inbox.readAllNeedsClient") : undefined}
              >
                {bulkPhase === "saving" ? t("inbox.savingAll") : `${t("inbox.saveAll")} (${saveableCount})`}
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

            {branchRequired && !branchId && Object.values(work).some((w) => w.docs?.length) && (
              <div className="mt-4 rounded-xl border border-warning/30 bg-warning-50 px-4 py-2.5 text-sm text-warning" role="alert">
                {t("analyze.selectBranchToSave")}
              </div>
            )}

            {bulkBusy && bulkTotal > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>
                    {bulkPhase === "reading" ? t("inbox.readingDocs") : t("inbox.savingDocs")} · {bulkDone} {t("analyze.ofCount")} {bulkTotal}
                  </span>
                  <span className="tnum">{bulkPct}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-[width] duration-300"
                    style={{ width: `${bulkPct}%` }}
                  />
                </div>
              </div>
            )}

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
          {discardableItems.length > 0 && (
            <div className="flex items-center gap-3 px-1 text-sm">
              <label className="flex items-center gap-1.5 text-muted">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                {t("inbox.selectAll")}
              </label>
              {/*
                Descartar de uma vez o que a leitura já classificou como
                sujeira. Só aparece quando existe — botão que quase sempre não
                faz nada acaba clicado sem querer.
              */}
              {junkIds.length > 0 && (
                <button
                  className="btn-ghost h-8 px-3 text-xs text-danger"
                  onClick={() => { setSelectedIds(new Set(junkIds)); }}
                  title="Marca os documentos ilegíveis / que não são documento, para você conferir e descartar."
                >
                  Marcar sujeira ({junkIds.length})
                </button>
              )}
              {selectedIds.size > 0 && (
                <button
                  className="btn-ghost h-8 px-3 text-xs text-danger"
                  onClick={discardSelected}
                  disabled={discardingSelected}
                >
                  {discardingSelected ? t("inbox.discarding") : t("inbox.discardSelected", { n: String(selectedIds.size) })}
                </button>
              )}
            </div>
          )}
          {items.map((item) => (
            <InboxCard
              key={item.id} item={item} work={work[item.id]} clients={clients}
              canRead={Boolean(clientId) && item.client_id === clientId}
              canSave={canSave}
              backTo={lockedClientId ? `/clients/${lockedClientId}/inbox` : "/inbox"}
              sheetHref={item.client_id ? `/clients/${item.client_id}/sales` : null}
              selectable={item.status !== "saved"}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => toggleOne(item.id)}
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
  item, work, clients, canRead, canSave, backTo, sheetHref, selectable, selected, onToggleSelect, onRead, onSave, onMerge, onDiscard,
}: {
  item: Item; work: Work | undefined; clients: Client[];
  canRead: boolean; canSave: boolean;
  /** Para a tela de revisão saber de que cliente é a nota e manter o menu do módulo. */
  backTo: string;
  /** Tela de Vendas deste cliente, para mandar a planilha ao leitor certo. */
  sheetHref: string | null;
  selectable: boolean; selected: boolean; onToggleSelect: () => void;
  onRead: () => void; onSave: (force?: boolean) => void; onMerge: () => void; onDiscard: () => void;
}) {
  const { t } = useT();
  const open = (id: string) => `/invoice/${id}?from=${encodeURIComponent(backTo)}`;
  const client = clients.find((c) => c.id === item.client_id);
  const docs = work?.docs ?? [];
  // A classificação vem da leitura; sem ler ainda, não há o que dizer.
  const kind = docs[0]?.header?.doc_kind;
  const kindInfo = kind ? KIND_LABEL[kind] : undefined;
  const junk = kindInfo?.junk ? kindInfo : null;
  const kindReason = docs[0]?.header?.doc_kind_reason ?? null;
  /*
   * PLANILHA não grava por aqui.
   *
   * O leitor desta tela é o de NOTA: ele leria as linhas da folha como itens
   * de um documento só, e a planilha de 5 vendas viraria UMA venda — com a
   * data e o cliente de uma linha qualquer, e o valor provavelmente saído da
   * linha de TOTAL. Cada linha é uma venda com data e cliente próprios, e isso
   * só o leitor de planilha sabe ler (lib/extractor/salesSheet.ts).
   */
  const isSheet = kind === "sales_sheet";

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {selectable && (
            <input
              type="checkbox" checked={selected} onChange={onToggleSelect}
              className="mt-1 shrink-0" aria-label={t("inbox.selectOne")}
            />
          )}
          <div className="min-w-0">
          <p className="font-medium">
            {item.filename || t("inbox.noAttachment")}
            {item.size_bytes ? <span className="ml-2 text-xs font-normal text-muted">{kb(item.size_bytes)}</span> : null}
          </p>
          <p className="mt-0.5 text-sm text-muted">
            {item.sender || t("inbox.noSender")} · {stamp(item.received_at || item.created_at)}
            {client ? ` · ${client.client_code} ${client.name}` : ` · ${t("inbox.noClient")}`}
            {item.direction ? ` · ${item.direction === "sale" ? t("inbox.sale") : t("inbox.purchase")}` : ""}
          </p>
          {item.subject && <p className="mt-0.5 truncate text-sm">{item.subject}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/*
            VENDA é dito em destaque: é o único caso em que gravar manda o
            documento para OUTRA tabela (débito de IVA, não crédito), e o
            analista precisa ver isso antes de clicar, não depois.
          */}
          {item.direction === "sale" && (
            <span className="chip bg-violet-50 text-violet">{t("inbox.sale")}</span>
          )}
          {/* O que a leitura disse que é. Sujeira em vermelho. */}
          {kindInfo && (
            <span className={kindInfo.junk ? "chip-danger" : "chip bg-surface-2 border border-line text-muted"}>
              {kindInfo.text}
            </span>
          )}
          {/*
            De onde veio. O telefone ganha destaque porque é a porta em que o
            escritório mais precisa confiar sem poder ver o remetente: quem
            mandou não tem conta no sistema, só o link.
          */}
          <span className={item.source === "phone" ? "chip bg-brand-50 text-brand-700" : "chip bg-surface-2 border border-line text-muted"}>
            {t(originLabelKey(item.source))}
          </span>
          <StatusChip item={item} savedIds={work?.savedIds} />
        </div>
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

      {/*
        SUJEIRA reconhecida na leitura: foto ilegível, ou algo que nem é
        documento fiscal. Aviso separado do "revisar" de propósito — a saída é
        outra: leitura fraca se confere, sujeira se descarta (ou se pede foto
        nova). Sem esta distinção, os dois casos vinham como o mesmo aviso
        amarelo e o analista abria um a um para descobrir qual era qual.
      */}
      {junk && (
        <div className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger">
          <span className="font-medium">Não parece um documento aproveitável: {junk.text}.</span>
          {kindReason ? <span className="block text-xs">{kindReason}</span> : null}
          <span className="mt-1 block text-xs">Confira pelo “Ver documento” antes de descartar.</span>
        </div>
      )}

      {/*
        Planilha reconhecida: manda para o leitor certo em vez de gravar
        errado. Sem este aviso, o gesto natural (clicar em Gravar) produzia UMA
        venda com o total da folha — um número que fecha e está errado, que é o
        pior tipo de erro numa apuração.
      */}
      {isSheet && (
        <div className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning">
          <span className="font-medium">Isto é uma planilha com várias vendas, não uma nota.</span>
          <span className="mt-1 block text-xs">
            Gravar aqui criaria UMA venda só, com o total da folha. Baixe pelo “Ver documento” e
            envie em <strong>Vendas → Foto de planilha (IA)</strong>, onde cada linha vira uma venda.
          </span>
          {sheetHref && (
            <Link href={sheetHref} className="btn-ghost mt-2 inline-flex h-8 px-3 text-xs">
              Abrir Vendas →
            </Link>
          )}
        </div>
      )}

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
          <Link href={open(work.duplicate.id)} className="underline">{t("inbox.dupOpen")}</Link>,{" "}
          <button className="underline" onClick={onMerge}>{t("inbox.dupMerge")}</button>{" "}
          <button className="underline" onClick={() => onSave(true)}>{t("inbox.dupSaveAnyway")}</button>.
          <span className="mt-1 block text-xs">{t("inbox.dupMergeHelp")}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/*
          "duplicate" entra aqui também: é status GRAVADO no banco, e o card
          de resolução (juntar / gravar mesmo assim) só existe enquanto
          `work[item.id]` está na memória — some ao recarregar a tela. Sem
          reabrir a leitura, um item "duplicate" ficava sem nenhuma ação além
          de Descartar, permanentemente.
        */}
        {(item.status === "pending" || item.status === "read" || item.status === "duplicate") && item.client_id && (
          <>
            {!docs.length ? (
              <button className="btn-primary h-9 px-4 text-sm" onClick={onRead} disabled={work?.busy || !canRead}>
                {work?.busy ? t("inbox.reading") : t("inbox.read")}
              </button>
            ) : (
              /*
               * Sujeira não grava. O botão continua visível para o analista ver
               * que existe, mas travado: uma foto ilegível virando lançamento é
               * número inventado dentro da apuração, e ninguém acharia depois.
               */
              <button
                className="btn-primary h-9 px-4 text-sm"
                onClick={() => onSave(false)}
                disabled={work?.busy || !canSave || Boolean(junk) || isSheet}
                title={
                  junk ? "Documento ilegível ou fora de escopo — descarte ou peça uma foto nova."
                  : isSheet ? "Planilha de vendas — use Vendas → Foto de planilha, onde cada linha vira uma venda."
                  : undefined
                }
              >
                {work?.busy ? t("inbox.saving") : t("inbox.save", { n: docs.length })}
              </button>
            )}
          </>
        )}
        {item.filename && (
          <a
            className={`btn-ghost h-9 px-3 text-sm ${item.status === "saved" ? "" : "ml-auto"}`}
            href={`/api/mail/inbox/${item.id}/file`}
            target="_blank"
            rel="noreferrer"
          >
            {t("inbox.viewDocument")}
          </a>
        )}
        {item.status !== "saved" && (
          <button className="btn-ghost ml-auto h-9 px-3 text-sm text-danger" onClick={onDiscard} disabled={work?.busy}>
            {t("inbox.discard")}
          </button>
        )}
        {item.status === "saved" && item.invoice_id && (
          <Link className="btn-ghost ml-auto h-9 px-3 text-sm" href={open(item.invoice_id)}>
            {t("inbox.openInvoice")}
          </Link>
        )}
      </div>

      {!canRead && (item.status === "pending" || item.status === "read" || item.status === "duplicate") && item.client_id && (
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
