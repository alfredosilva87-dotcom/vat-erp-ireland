"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

type Group = { key: string; rows: any[] };

/**
 * A tela de resultados da busca.
 *
 * Agrupada por tipo, e não numa lista única ordenada por "relevância": num ERP
 * quem procura já sabe o que quer — "a nota da Musgrave", "o cliente Elverin" —
 * e o que falta é o caminho até lá. Uma lista misturada obriga a ler tudo para
 * achar a linha do tipo certo.
 *
 * Lê o termo de `window.location` e não de `useSearchParams()`: aquele hook
 * obriga toda rota do app a ter fronteira de Suspense, senão o build quebra.
 */
export default function SearchPage() {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = useCallback(async (termo: string) => {
    if (termo.trim().length < 2) {
      setGroups([]); setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(termo)}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error || "Falhou.");
      setGroups((await r.json()).groups || []);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * De onde a busca partiu.
   *
   * Buscar tira a pessoa do workspace do cliente e larga-a no painel geral —
   * é o preço de a busca varrer o escritório inteiro. Sem um caminho de volta,
   * cada busca custava escolher a empresa outra vez, e uma busca não devia
   * custar isso.
   *
   * Só se aceita caminho interno (`/…`): `from` vem da barra de endereços, e
   * um `//outro-site` ali viraria um redirecionamento para fora vestido de
   * botão do sistema.
   */
  const [voltar, setVoltar] = useState<string | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const termo = sp.get("q") || "";
    const origem = sp.get("from") || "";
    setVoltar(/^\/(?!\/)/.test(origem) && origem !== "/search" ? origem : null);
    setQ(termo);
    buscar(termo);
  }, [buscar]);

  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  const eur = (v: any) =>
    "€" + Number(v || 0).toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("search.title")}</h1>
          <p className="mt-1 text-muted">
            {q ? t("search.forTerm", { q, n: total }) : t("search.typeSomething")}
          </p>
        </div>
        {voltar && (
          <Link href={voltar} className="btn-ghost">← {t("search.back")}</Link>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const url = new URL(window.location.href);
          url.searchParams.set("q", q);
          window.history.replaceState(null, "", url.toString());
          buscar(q);
        }}
      >
        <input
          className="input max-w-md"
          value={q}
          autoFocus
          placeholder={t("nav.search")}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn-primary" type="submit">{t("search.go")}</button>
      </form>

      {erro && <p className="text-sm text-danger">{erro}</p>}
      {loading && <p className="text-sm text-muted">{t("common.loading")}</p>}

      {!loading && q.trim().length >= 2 && !total && (
        <div className="card p-10 text-center text-muted">{t("search.nothing", { q })}</div>
      )}

      {groups.map((g) => (
        <div key={g.key} className="card overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
            <h2 className="font-display text-sm font-semibold">{t(("search.group_" + g.key) as any)}</h2>
            <span className="text-xs text-muted">{g.rows.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="row-hover w-full text-sm">
              <tbody>
                {g.key === "clients" && g.rows.map((c) => (
                  <tr key={c.id} className="border-b border-line/70">
                    <td className="px-4 py-2 font-mono text-xs text-muted">{c.client_code}</td>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/clients/${c.id}`} className="hover:text-brand-700">{c.name}</Link>
                    </td>
                    <td className="px-4 py-2 text-muted">{c.contact_person || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{c.vat_number || "—"}</td>
                  </tr>
                ))}

                {g.key === "invoices" && g.rows.map((i) => (
                  <tr key={i.id} className="border-b border-line/70">
                    <td className="px-4 py-2 font-mono text-xs text-muted">{i.invoice_date || "—"}</td>
                    <td className="px-4 py-2 font-medium">
                      {/* `from` diz de que cliente a nota é, para o menu do
                          módulo não cair no menu geral — ver ClientScope. */}
                      <Link
                        href={`/invoice/${i.id}${i.client_id ? `?from=/clients/${i.client_id}/purchases` : ""}`}
                        className="hover:text-brand-700"
                      >
                        {i.supplier_name || i.store_name || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{i.invoice_number || "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted">{i.client_name || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{eur(i.total_gross)}</td>
                  </tr>
                ))}

                {g.key === "sales" && g.rows.map((s) => (
                  <tr key={s.id} className="border-b border-line/70">
                    <td className="px-4 py-2 font-mono text-xs text-muted">{s.entry_date || "—"}</td>
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/clients/${s.client_id}/sales`} className="hover:text-brand-700">
                        {s.customer || "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{s.doc_number || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {eur(Number(s.net_amount || 0) + Number(s.vat_amount || 0))}
                    </td>
                  </tr>
                ))}

                {g.key === "items" && g.rows.map((it) => (
                  <tr key={it.id} className="border-b border-line/70">
                    <td className="px-4 py-2 font-medium">
                      <Link href="/items" className="hover:text-brand-700">{it.canonical_name}</Link>
                    </td>
                    <td className="px-4 py-2 text-muted">{it.category_name || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {it.expected_vat_rate != null ? `${it.expected_vat_rate}%` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-muted">
                      {t("search.seenTimes", { n: it.occurrences ?? 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {total > 0 && <p className="text-xs text-muted">{t("search.capped")}</p>}
    </div>
  );
}
