"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useHrYear } from "@/components/hr/useHrYear";
import { useHrCompanies } from "@/components/hr/useHrCompanies";
import WhatsAppLink from "@/components/WhatsAppLink";
import { waMostrar, waNumber } from "@/lib/whatsapp";

/**
 * Quem contactar, e por onde.
 *
 * A tela existe por causa de um número que ninguém tinha: quantas empresas o
 * escritório NÃO consegue alcançar. Sem e-mail nem telefone, pedir as horas da
 * semana vira telefonema para um número que já não existe — e isso só se
 * descobre na sexta-feira.
 *
 * A etiqueta de quem está incompleto leva direto ao cadastro do cliente, em
 * vez de dizer que falta e deixar a pessoa procurar onde se conserta.
 */
export default function HrContacts() {
  const { t } = useT();
  const [year, setYear] = useHrYear();
  const { companies, loading, erro } = useHrCompanies(year);
  const [soIncompletos, setSoIncompletos] = useState(false);
  const [recado, setRecado] = useState("");
  /*
   * Quem ja foi aberto nesta sessao.
   *
   * O WhatsApp nao aceita envio em massa — e ainda bem. Sao 35 conversas
   * abertas uma a uma, e sem esta marca a pessoa perde a conta de onde ia e
   * manda a mesma mensagem duas vezes ao mesmo cliente.
   *
   * Nao se grava: e memoria da tarefa de agora, nao um facto do cliente.
   */
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const temEmail = (c: { email: string | null }) => !!c.email?.trim();
  // O que conta como "tem telefone" e o que o WhatsApp CONSEGUE marcar — um
  // campo preenchido com "—" ou com uma extensao nao serve de nada.
  const temFone = (c: { phone: string | null }) => !!waNumber(c.phone);

  const comEmail = companies.filter(temEmail).length;
  const comFone = companies.filter(temFone).length;
  const semNada = companies.filter((c) => !temEmail(c) && !temFone(c)).length;

  const lista = soIncompletos
    ? companies.filter((c) => !temEmail(c) || !temFone(c))
    : companies;

  const emails = companies.filter(temEmail).map((c) => c.email!.trim());

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{t("hr.navContacts")}</h1>
          <p className="mt-1 text-muted">{t("hr.contactsSubtitle")}</p>
        </div>
        {/*
          BCC e não "para": um e-mail com 13 endereços no campo visível entrega
          a carteira de clientes do escritório a cada um deles.
        */}
        <a
          className={`btn-primary ${emails.length ? "" : "pointer-events-none opacity-50"}`}
          href={`mailto:?bcc=${encodeURIComponent(emails.join(","))}`}
        >
          {t("hr.emailBcc", { n: emails.length })}
        </a>
      </div>

      {erro && <p className="text-sm text-danger">{erro}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao rotulo={t("hr.contactsListed")} valor={companies.length} />
        <Cartao rotulo={t("hr.contactsWithEmail")} valor={comEmail} tom="ok" />
        <Cartao rotulo={t("hr.contactsWithPhone")} valor={comFone} />
        <Cartao rotulo={t("hr.contactsUnreachable")} valor={semNada} tom={semNada ? "danger" : undefined} />
      </div>

      {semNada > 0 && (
        <p className="text-sm text-muted">{t("hr.contactsUnreachableNote", { n: semNada })}</p>
      )}

      {/*
        * A MENSAGEM escreve-se UMA vez, e vai em todas as conversas.
        *
        * Sem isto, pedir as horas a 35 clientes obriga a reescrever a mesma
        * frase 35 vezes — e a partir da quinta ela vem diferente, o que faz o
        * escritorio parecer desorganizado a quem recebe as duas.
        */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted">
              {t("hr.waMessage")}
            </span>
            <input className="input mt-1 w-full text-sm" value={recado}
              onChange={(e) => setRecado(e.target.value)}
              placeholder={t("hr.waMessagePlaceholder")} />
          </label>
          <p className="pb-1 text-[12px] text-muted">
            {t("hr.waOpened", { n: abertos.size, total: comFone })}
          </p>
        </div>
        <p className="mt-2 max-w-3xl text-[12px] text-muted">{t("hr.waHelp")}</p>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2/60 px-4 py-2.5">
          <h2 className="font-display text-sm font-semibold">{t("hr.contactsTable")}</h2>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-brand"
              checked={soIncompletos}
              onChange={(e) => setSoIncompletos(e.target.checked)}
            />
            {t("hr.contactsOnlyIncomplete")}
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">{t("hr.colId")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colCompany")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colContact")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colEmail")}</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colPhone")}</th>
                <th className="px-4 py-2.5 text-center font-medium">WA</th>
                <th className="px-4 py-2.5 font-medium">{t("hr.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const e = temEmail(c);
                const f = temFone(c);
                return (
                  <tr key={c.id} className="border-b border-line/70">
                    <td className="px-4 py-2 font-mono text-xs text-muted">{c.client_code}</td>
                    <td className="px-4 py-2 font-medium">{c.name}</td>
                    <td className="px-4 py-2 text-muted">{c.contact_person || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{c.email || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs">{waMostrar(c.phone)}</td>
                    <td className="px-4 py-2 text-center">
                      <WhatsAppLink phone={c.phone} nome={c.name} texto={recado}
                        semTelefone={t("hr.waNoPhone")}
                        abrir={() => setAbertos((s) => new Set(s).add(c.id))} />
                      {abertos.has(c.id) && (
                        <span className="ml-1 text-[11px] text-ok">✓</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {e && f ? (
                        <span className="chip-ok">{t("hr.contactComplete")}</span>
                      ) : (
                        <Link href={`/clients/${c.id}/settings`} className="chip-warn hover:underline">
                          {!e && !f ? t("hr.contactNone") : !e ? t("hr.contactNoEmail") : t("hr.contactNoPhone")}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!lista.length && !loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("hr.noCompanies")}</td></tr>
              )}
              {loading && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">{t("common.loading")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Cartao({ rotulo, valor, tom }: { rotulo: string; valor: number; tom?: "ok" | "danger" }) {
  const cor = tom === "ok" ? "text-success" : tom === "danger" ? "text-danger" : "";
  return (
    <div className="card p-4">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted">{rotulo}</div>
      <div className={`mt-0.5 font-display text-2xl font-semibold tabular-nums ${cor}`}>{valor}</div>
    </div>
  );
}
