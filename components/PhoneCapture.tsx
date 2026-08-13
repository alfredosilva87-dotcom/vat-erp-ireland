"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * A tela que o cliente do escritório usa no posto de combustível.
 *
 * Três coisas moldaram este componente, e nenhuma é estética:
 *
 * 1. **A imagem é reduzida antes de sair.** A Vercel corta o corpo de uma
 *    requisição em 4,5 MB e foto de telefone moderno passa disso sozinha. Reduzir
 *    também é o que faz o envio terminar no 4G do posto em vez de ficar girando.
 *    Nota fiscal não precisa de 12 megapixels: a borda longa em 2000 px lê
 *    melhor que a foto cheia, porque o leitor recebe menos ruído de compressão.
 *
 * 2. **A fila sobrevive ao fechamento.** Estacionamento subterrâneo e interior da
 *    Irlanda não têm sinal, e foto tirada e perdida é pior que foto não tirada —
 *    o cliente acha que mandou. A fila fica no IndexedDB, com o arquivo, e é
 *    retomada quando a página abre de novo ou quando o sinal volta.
 *
 * 3. **O envio é confirmado na hora.** Se ele fotografa e nada responde, ele
 *    fotografa de novo. Os 30 minutos até o escritório buscar são invisíveis
 *    desde que o "Enviado" apareça imediatamente.
 */

type ItemStatus = "queued" | "sending" | "sent" | "failed";

interface QueueItem {
  id: string;
  blob: Blob;
  mime: string;
  note: string;
  direction: "purchase" | "sale";
  status: ItemStatus;
  reason?: string;
  /** Miniatura para a lista. Fica fora do IndexedDB: recriável, e pesa. */
  preview?: string;
}

const DB = "vat-snap";
const STORE = "queue";
const LONG_EDGE = 2000;
const JPEG_QUALITY = 0.8;
const MAX_BYTES = 4 * 1024 * 1024;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      // Navegação privada do Safari recusa IndexedDB. Nesse caso a fila vive só
      // em memória: pior, mas não pode derrubar a tela.
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function dbPut(item: QueueItem) {
  const db = await openDb();
  if (!db) return;
  const { preview, ...rest } = item;
  db.transaction(STORE, "readwrite").objectStore(STORE).put(rest);
}

async function dbDelete(id: string) {
  const db = await openDb();
  if (!db) return;
  db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
}

async function dbAll(): Promise<QueueItem[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result || []) as QueueItem[]);
    req.onerror = () => resolve([]);
  });
}

/**
 * Reduz e recomprime a foto.
 *
 * PDF passa direto: reprocessar um PDF por canvas o transformaria numa imagem e
 * jogaria fora o texto que o leitor do escritório usa — é justamente o caminho
 * bom que a camada A6 recuperou.
 */
async function shrink(file: File): Promise<{ blob: Blob; mime: string }> {
  if (file.type === "application/pdf") return { blob: file, mime: file.type };

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { blob: file, mime: file.type };

  const scale = Math.min(1, LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { blob: file, mime: file.type };
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((r) =>
    canvas.toBlob((b) => r(b), "image/jpeg", JPEG_QUALITY));
  // Se o navegador não devolveu nada, manda o original: a rota confere o teto e
  // recusa com motivo, o que é melhor que engolir a foto aqui em silêncio.
  if (!blob) return { blob: file, mime: file.type };
  return { blob, mime: "image/jpeg" };
}

export default function PhoneCapture({
  token, label, allowSale,
}: { token: string; label: string | null; allowSale: boolean }) {
  const { t } = useT();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [note, setNote] = useState("");
  const [direction, setDirection] = useState<"purchase" | "sale">("purchase");
  const [offline, setOffline] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (id: string, over: Partial<QueueItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...over } : i)));

  const send = useCallback(async (item: QueueItem) => {
    patch(item.id, { status: "sending", reason: undefined });
    const form = new FormData();
    form.set("token", token);
    form.set("upload_id", item.id);
    form.set("direction", item.direction);
    if (item.note) form.set("note", item.note);
    form.set("file", new File([item.blob], "documento", { type: item.mime }));

    try {
      const res = await fetch("/api/phone/upload", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.ok) {
        patch(item.id, { status: "sent" });
        // Sai da fila persistida assim que o servidor confirmou. O item continua
        // na tela para o cliente ver que foi, mas não volta se ele reabrir.
        await dbDelete(item.id);
        return;
      }
      const reason = String(body?.reason || "server");
      // Recusa definitiva não se repete: tentar de novo daria o mesmo resultado
      // e ainda gastaria o teto de envios do link.
      const permanent = ["type", "too_big", "too_small", "bad_token", "inactive", "expired"];
      patch(item.id, { status: "failed", reason });
      if (permanent.includes(reason)) await dbDelete(item.id);
    } catch {
      // Rede caiu no meio. Volta para a fila: o mesmo upload_id chega depois e a
      // passagem reconhece, então repetir é inofensivo.
      patch(item.id, { status: "queued", reason: undefined });
    }
  }, [token]);

  const add = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const { blob, mime } = await shrink(file);
      const item: QueueItem = {
        id: crypto.randomUUID(), blob, mime, note: note.trim(), direction,
        status: "queued", preview: mime === "application/pdf" ? undefined : URL.createObjectURL(blob),
      };
      setItems((prev) => [item, ...prev]);
      await dbPut(item);
      if (blob.size > MAX_BYTES) {
        patch(item.id, { status: "failed", reason: "too_big" });
        await dbDelete(item.id);
        continue;
      }
      void send(item);
    }
    setNote("");
  }, [note, direction, send]);

  // Retoma o que ficou de uma sessão anterior: é isto que faz a foto tirada sem
  // sinal chegar quando ele abre a página em casa.
  useEffect(() => {
    let alive = true;
    dbAll().then((stored) => {
      if (!alive || !stored.length) return;
      const restored = stored.map((s) => ({
        ...s, status: "queued" as ItemStatus,
        preview: s.mime === "application/pdf" ? undefined : URL.createObjectURL(s.blob),
      }));
      setItems((prev) => [...prev, ...restored]);
      restored.forEach((i) => void send(i));
    });
    return () => { alive = false; };
  }, [send]);

  // Sinal voltou: tenta a fila inteira. É o caminho normal do caso "saiu do
  // estacionamento", e não depende de o cliente tocar em nada.
  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      setItems((prev) => {
        prev.filter((i) => i.status === "queued" || i.status === "failed").forEach((i) => void send(i));
        return prev;
      });
    };
    const onOffline = () => setOffline(true);
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [send]);

  const reasonText = (reason?: string) =>
    reason === "too_big" ? t("snap.tooBig")
    : reason === "type" || reason === "too_small" ? t("snap.badType")
    : reason === "rate" ? t("snap.rate")
    : reason === "inactive" ? t("snap.linkInactive")
    : reason === "expired" ? t("snap.linkExpired")
    : t("snap.serverError");

  const pending = items.filter((i) => i.status === "queued" || i.status === "sending").length;

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div className="relative mx-auto w-full max-w-md px-5 pb-40 pt-7">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="VAT Reader" className="h-11 w-11 shrink-0 rounded-xl shadow-brand" />
            <div>
              <div className="font-display text-lg font-semibold leading-tight text-ink">
                VAT <span className="text-brand">READER</span>
              </div>
              <div className="text-xs font-medium tracking-wide text-muted">Ireland · ERP</div>
            </div>
          </div>
        </div>

        <h1 className="mt-8 font-display text-3xl font-semibold leading-tight text-ink">
          {t("snap.title")}
        </h1>
        {label && (
          <p className="mt-1 text-sm text-muted">
            {t("snap.sendingTo")}: <span className="font-medium text-brand">{label}</span>
          </p>
        )}

        {/* Botões grandes: quem usa está de pé, na chuva, com uma mão. */}
        <div className="mt-6 grid gap-3">
          <button
            className="btn-primary flex h-[4.5rem] items-center justify-between gap-3 rounded-2xl px-5 text-left text-base"
            onClick={() => cameraRef.current?.click()}
          >
            <span className="flex items-center gap-3">
              <CameraIcon className="h-9 w-9 shrink-0 rounded-full bg-white/20 p-2" />
              <span>
                <span className="block font-semibold">{t("snap.takePhoto")}</span>
                <span className="block text-xs font-normal text-white/80">{t("snap.takePhotoHint")}</span>
              </span>
            </span>
            <ChevronIcon className="h-5 w-5 shrink-0 text-white/70" />
          </button>

          <button
            className="card flex h-[4.5rem] items-center justify-between gap-3 rounded-2xl px-5 text-left"
            onClick={() => fileRef.current?.click()}
          >
            <span className="flex items-center gap-3">
              <GalleryIcon className="h-9 w-9 shrink-0 rounded-full bg-brand/10 p-2 text-brand" />
              <span>
                <span className="block font-semibold text-ink">{t("snap.chooseFile")}</span>
                <span className="block text-xs font-normal text-muted">{t("snap.chooseFileHint")}</span>
              </span>
            </span>
            <ChevronIcon className="h-5 w-5 shrink-0 text-muted" />
          </button>
        </div>

        {/* `capture="environment"` abre a câmera de trás direto, sem passar pela
            galeria. É o que separa 3 toques de 6. */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { void add(e.target.files); e.currentTarget.value = ""; }} />
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { void add(e.target.files); e.currentTarget.value = ""; }} />

        <div className="mt-5 grid gap-3">
          <label className="card grid gap-1 rounded-2xl p-4 text-sm">
            <span className="text-muted">{t("snap.note")}</span>
            <input className="input h-11 border-none bg-transparent px-0 focus:ring-0" value={note}
              placeholder={t("snap.notePlaceholder")}
              onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </label>

          {/* Só aparece quando o link permite venda. Sem isso, o cliente teria que
              classificar o documento, que é o trabalho do analista. */}
          {allowSale && (
            <div className="grid gap-1 text-sm">
              <span className="text-muted">{t("snap.kind")}</span>
              <div className="flex gap-2">
                {(["purchase", "sale"] as const).map((d) => (
                  <button key={d}
                    className={`h-11 flex-1 rounded-lg border text-sm ${direction === d ? "border-brand bg-brand/10 font-medium" : "border-line"}`}
                    onClick={() => setDirection(d)}>
                    {d === "purchase" ? t("snap.kindCost") : t("snap.kindSale")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card mt-5 flex items-center gap-3 rounded-2xl p-4">
          <ClockIcon className="h-9 w-9 shrink-0 rounded-full bg-brand/10 p-2 text-brand" />
          <p className="text-sm text-ink">
            <span className="font-semibold">{t("snap.arrivesTitle")}</span>
            <br />
            <span className="text-muted">{t("snap.arrives")}</span>
          </p>
        </div>

        {offline && <p className="mt-3 text-xs text-amber-700">{t("snap.keepOpen")}</p>}
        {pending > 0 && (
          <p className="mt-2 text-xs text-muted">{t("snap.pending", { n: String(pending) })}</p>
        )}

        <ul className="mt-5 grid gap-2">
          {items.map((i) => (
            <li key={i.id} className="card flex items-center gap-3 rounded-xl p-2">
            {i.preview
              ? <img src={i.preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
              : <div className="grid h-14 w-14 place-items-center rounded-lg bg-surface text-xs">PDF</div>}
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {i.status === "sent" ? t("snap.sent")
                  : i.status === "sending" ? t("snap.sending")
                  : i.status === "failed" ? t("snap.failed")
                  : t("snap.queued")}
              </p>
              {i.status === "failed" && <p className="text-xs text-muted">{reasonText(i.reason)}</p>}
              {i.note && <p className="truncate text-xs text-muted">{i.note}</p>}
            </div>
            {i.status === "failed" && (
              <button className="btn-ghost h-9 px-3 text-xs" onClick={() => void send(i)}>
                {t("snap.retry")}
              </button>
            )}
            </li>
          ))}
        </ul>

        {/* O que a curva embaixo esconde: o rodapé de confiança abaixo dela.
            Fica por cima da onda, não atrás — por isso o padding do container
            principal (pb-40) abre espaço para os dois não se sobreporem. */}
        <p className="mt-8 text-center text-xs text-muted">{t("snap.installHint")}</p>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0">
        <svg viewBox="0 0 500 90" className="block w-full text-brand/[0.09]" preserveAspectRatio="none">
          <path fill="currentColor" d="M0,40 C120,90 380,0 500,45 L500,90 L0,90 Z" />
        </svg>
        <div className="bg-brand/[0.09] pb-8 pt-2">
          <div className="mx-auto flex max-w-md items-center justify-center gap-2.5 px-5 text-center">
            <ShieldIcon className="h-5 w-5 shrink-0 text-brand" />
            <p className="text-xs text-muted">
              <span className="font-medium text-ink">{t("snap.trustTitle")}</span>{" "}
              {t("snap.trustBody")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function CameraIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

function GalleryIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m5 17 4.5-5 3 3.2L16 11l3.5 6" />
    </svg>
  );
}

function ClockIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function ShieldIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3.5 5 6v5.5c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-2.5Z" />
      <path d="m9 12 2 2 4-4.2" />
    </svg>
  );
}

function ChevronIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
