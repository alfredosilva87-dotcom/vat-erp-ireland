"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TIPOS_DE_DOCUMENTO, type DocumentoDoCliente } from "@/lib/fiscal/cofreTipos";
import { useT } from "@/lib/i18n";

/**
 * O cofre de documentos do cliente, dentro do cadastro dele.
 *
 * ---------------------------------------------------------------------------
 * POR QUE AQUI E NÃO NUMA TELA PRÓPRIA
 *
 * Estes documentos — identidade, morada, pacto social — são cadastro, não
 * movimento: entram uma vez e ficam. Uma tela própria seria mais uma aba que
 * ninguém abre, e o sítio onde falta a identidade de um cliente é exatamente o
 * ecrã onde se olha para o cliente.
 * ---------------------------------------------------------------------------
 *
 * A validade é o que faz isto valer mais do que uma pasta partilhada: uma
 * pasta não sabe que o passaporte caduca em março.
 */

const ROTULO = Object.fromEntries(TIPOS_DE_DOCUMENTO.map((t) => [t.valor, t.rotulo]));
// `Set<string>` de propósito: `kind` vem do <select> como string, e estreitá-lo
// aqui só para o `has` obrigaria a um cast que não protege nada.
const CADUCA: Set<string> = new Set(TIPOS_DE_DOCUMENTO.filter((t) => t.caduca).map((t) => t.valor));

function tamanho(bytes: number | null) {
  if (!bytes) return "";
  // Abaixo de 1 KB o arredondamento dava "0 KB", que se le como ficheiro
  // partido. Vale mais dizer os bytes crus.
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A cor da validade, e a frase que a acompanha. */
/**
 * O `t` vem POR ARGUMENTO, e não de um `useT()` aqui dentro.
 *
 * Esta função não é um componente, e um hook só corre dentro de um. Tipar o
 * parâmetro à mão daria uma assinatura ligeiramente diferente da real e o
 * `tsc` recusava; `ReturnType` colhe a verdadeira, e acompanha-a se ela mudar.
 */
function validade(
  d: DocumentoDoCliente,
  t: ReturnType<typeof useT>["t"]
): { chip: string; texto: string } | null {
  if (d.validade === "sem_prazo") return null;
  if (d.validade === "caducado") {
    return { chip: "chip-danger", texto: t("vault.expiredDays", { n: Math.abs(d.diasParaCaducar!) }) };
  }
  if (d.validade === "a_caducar") {
    return { chip: "chip-warning", texto: t("vault.expiresDays", { n: d.diasParaCaducar ?? 0 }) };
  }
  return { chip: "chip-ok", texto: t("vault.validTo", { n: d.expiresOn ?? "" }) };
}

export default function ClientVault({ clientId }: { clientId: string }) {
  const { t } = useT();
  const [docs, setDocs] = useState<DocumentoDoCliente[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [zipando, setZipando] = useState(false);
  const [kind, setKind] = useState<string>("identity");
  const [title, setTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/clients/${clientId}/vault`);
    const j = await r.json();
    setDocs(j.documentos ?? []);
  }, [clientId]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function enviar() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setErro(t("vault.pickFile")); return; }
    setEnviando(true);
    setErro(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      if (title.trim()) fd.append("title", title.trim());
      if (expiresOn) fd.append("expiresOn", expiresOn);
      const r = await fetch(`/api/clients/${clientId}/vault`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || t("vault.notStored")); return; }
      setDocs(j.documentos ?? []);
      setTitle("");
      setExpiresOn("");
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setEnviando(false);
    }
  }

  /**
   * O ZIP chega como bytes e não como um endereço, então o navegador precisa de
   * uma âncora temporária para o gravar. É feio, mas é o preço de a rota ser um
   * POST — e ela é um POST porque uma dúzia de uuids não cabe numa query string.
   */
  async function baixarSelecionados() {
    if (!marcados.size) return;
    setZipando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/vault/zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...marcados] }),
      });
      if (!r.ok) { setErro((await r.json()).error || t("vault.notZipped")); return; }

      const incluidos = Number(r.headers.get("X-Documentos-Incluidos") || 0);
      const nome = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || "documentos.zip";
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = nome;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);

      // Um ZIP com onze de doze ficheiros não pode parecer completo: se algum
      // não veio do armazenamento, quem montou o dossiê tem de saber ANTES de
      // o entregar ao banco.
      if (incluidos && incluidos < marcados.size) {
        setErro(t("vault.partial", { n: incluidos, t: marcados.size }));
      }
      setMarcados(new Set());
    } finally {
      setZipando(false);
    }
  }

  function alternar(id: string) {
    setMarcados((m) => {
      const novo = new Set(m);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  const caducados = (docs ?? []).filter((d) => d.validade === "caducado");
  const aCaducar = (docs ?? []).filter((d) => d.validade === "a_caducar");
  const aExpirar = [...caducados, ...aCaducar];

  return (
    <section className="rounded-xl2 border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-sm font-semibold">{t("vault.title")}</h2>
        <p className="text-xs text-muted">
          {t("vault.subtitle")}
        </p>
      </div>

      {/*
        * O aviso vem ANTES da lista.
        *
        * Um documento caducado no meio de oito linhas é um documento que
        * ninguém vê. Aqui em cima é a primeira coisa que se lê ao abrir o
        * cadastro — que é quando ainda dá tempo de pedir o novo.
        */}
      {aExpirar.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          {/*
            * As duas frases são SEPARADAS de propósito.
            *
            * Juntá-las numa só — "há documento caducado: morada, identidade" —
            * carimba de caducado um documento que ainda vale, e quem lê pede ao
            * cliente um papel que ele não precisa de trocar. São dois estados
            * com duas ações diferentes: um é urgente, o outro é agenda.
            */}
          {caducados.length > 0 && (
            <p>
              <strong>{t("vault.expired")}</strong>{" "}
              {caducados.map((d) => ROTULO[d.kind] ?? d.kind).join(", ")}.
            </p>
          )}
          {aCaducar.length > 0 && (
            <p>
              <strong>{t("vault.expiring")}</strong>{" "}
              {aCaducar.map((d) => `${ROTULO[d.kind] ?? d.kind} (${d.diasParaCaducar} dias)`).join(", ")}.
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">{t("vault.kind")}</span>
          <select className="input h-9 w-56" value={kind} onChange={(e) => setKind(e.target.value)}>
            {TIPOS_DE_DOCUMENTO.map((t) => (
              <option key={t.valor} value={t.valor}>{t.rotulo}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">{t("vault.desc")}</span>
          <input className="input h-9 w-56" placeholder={t("vault.optional")}
            value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {/*
          * A validade só aparece nos tipos que caducam.
          *
          * Um pacto social não expira, e pedir uma data que não existe convida
          * a inventar uma — que depois dispara um alarme falso.
          */}
        {CADUCA.has(kind) && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-muted">{t("vault.validUntil")}</span>
            <input type="date" className="input h-9 w-40"
              value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-muted">{t("vault.file")}</span>
          <input ref={fileRef} type="file" className="input h-9 w-72 py-1.5 text-xs"
            accept=".pdf,.png,.jpg,.jpeg,.heic,.webp" />
        </label>
        <button className="btn-primary h-9 px-4 text-sm" disabled={enviando} onClick={enviar}>
          {enviando ? t("common.saving") : t("common.save")}
        </button>
      </div>

      {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}

      {/*
        * A barra só existe quando há selecção.
        *
        * Um botão "descarregar seleccionados" sempre visível e quase sempre
        * desativado é ruído permanente para uma acção ocasional.
        */}
      {marcados.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
          <span className="text-xs text-muted">
            {t("vault.selected", { n: marcados.size, t: docs?.length ?? 0 })}
          </span>
          <button className="btn-primary h-8 px-3 text-xs" disabled={zipando} onClick={baixarSelecionados}>
            {zipando ? t("vault.zipping") : t("vault.downloadZip")}
          </button>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setMarcados(new Set())}>
            {t("common.clear")}
          </button>
          <span className="text-[11px] text-muted">{t("vault.zipHint")}</span>
        </div>
      )}

      {docs === null ? (
        <p className="mt-3 text-sm text-muted">{t("common.loading")}</p>
      ) : docs.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {t("vault.none")}
        </p>
      ) : (
        <table className="mt-3 w-full text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
              <th className="w-8 py-1 text-left font-medium">
                {/* Marcar tudo é o gesto mais comum: o dossiê completo. */}
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
                  checked={marcados.size > 0 && marcados.size === docs.length}
                  ref={(el) => { if (el) el.indeterminate = marcados.size > 0 && marcados.size < docs.length; }}
                  onChange={(e) => setMarcados(e.target.checked ? new Set(docs.map((d) => d.id)) : new Set())}
                />
              </th>
              <th className="py-1 text-left font-medium">{t("vault.kind")}</th>
              <th className="py-1 text-left font-medium">{t("vault.file")}</th>
              <th className="py-1 text-left font-medium">{t("vault.validity")}</th>
              <th className="py-1 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const v = validade(d, t);
              return (
                <tr key={d.id} className="border-b border-line/40">
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[rgb(var(--c-brand))]"
                      checked={marcados.has(d.id)}
                      onChange={() => alternar(d.id)}
                    />
                  </td>
                  <td className="py-1.5">
                    {ROTULO[d.kind] ?? d.kind}
                    {d.title && <span className="ml-2 text-muted">{d.title}</span>}
                  </td>
                  <td className="py-1.5">
                    <a className="underline" target="_blank" rel="noreferrer"
                      href={`/api/clients/${clientId}/vault/${d.id}`}>
                      {d.originalFilename || "documento"}
                    </a>
                    <span className="ml-2 text-[11px] text-muted">{tamanho(d.sizeBytes)}</span>
                  </td>
                  <td className="py-1.5">
                    {v ? <span className={`${v.chip} text-[11px]`}>{v.texto}</span>
                       : <span className="text-muted">—</span>}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    {/*
                      * Baixar é um LINK e não um botão com fetch: o navegador
                      * grava o ficheiro sozinho, com a barra de progresso dele,
                      * e um PDF de 12 MB não passa pela memória da página.
                      */}
                    <a
                      className="btn-ghost inline-flex h-7 items-center px-2 text-[11px]"
                      href={`/api/clients/${clientId}/vault/${d.id}?download=1`}
                    >
                      {t("vault.download")}
                    </a>
                    <button
                      className="btn-ghost h-7 px-2 text-[11px] text-danger"
                      onClick={async () => {
                        if (!confirm(t("vault.confirmDel", { n: d.originalFilename || ROTULO[d.kind] }))) return;
                        const r = await fetch(`/api/clients/${clientId}/vault/${d.id}`, { method: "DELETE" });
                        if (!r.ok) { setErro((await r.json()).error || t("vault.notDeleted")); return; }
                        await carregar();
                      }}
                    >
                      {t("common.delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
