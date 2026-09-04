"use client";

/**
 * COLAR A MENSAGEM DO WHATSAPP, E VER O QUE SAI ANTES DE GRAVAR.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ISTO EXISTE ASSIM, E NÃO COMO UMA INTEGRAÇÃO AUTOMÁTICA
 *
 * Ler o WhatsApp de alguém não é possível por via oficial: a Cloud API só
 * entrega mensagens enviadas para um número registado na plataforma Business,
 * e as horas chegam hoje ao telemóvel pessoal. Enquanto isso não mudar, copiar
 * e colar é o caminho — e continua a poupar o trabalho que interessa, que é
 * transcrever nome a nome.
 *
 * A leitura é a mesma que um webhook usaria. No dia em que houver um número
 * Business, muda quem alimenta isto, não o que acontece a seguir.
 *
 * ---------------------------------------------------------------------------
 * O ORIGINAL FICA SEMPRE AO LADO
 *
 * Cada linha lida mostra o texto de onde saiu. Quem confere não tem de confiar
 * na leitura — compara. É a diferença entre uma ajuda e uma caixa preta.
 */

import { useState } from "react";
import { useT } from "@/lib/i18n";

interface LinhaLida {
  nome: string;
  /** O total como a pessoa o escreveu. */
  horas: number | null;
  /** O que vai mesmo para a coluna das horas normais: o total menos o resto. */
  horasNormais: number | null;
  horasDomingo: number | null;
  horasFeriado: number | null;
  trabalhou: boolean;
  aviso: string | null;
  origem: string;
}

export default function ColarHoras({
  clientes, ano, onGravado,
}: {
  clientes: { id: string; name: string; client_code: string | null }[];
  ano: number;
  onGravado: () => void;
}) {
  const { t } = useT();
  const [clientId, setClientId] = useState("");
  const [texto, setTexto] = useState("");
  const [semana, setSemana] = useState<string>("");
  const [previa, setPrevia] = useState<{ linhas: LinhaLida[]; naoLidas: string[]; semana: number | null } | null>(null);
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function ler() {
    if (!clientId) { setMsg({ texto: t("wa.escolhaCliente"), erro: true }); return; }
    setOcupado(true); setMsg(null);
    try {
      const r = await fetch("/api/hr/submissions/from-text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, text: texto, year: ano }),
      });
      const d = await r.json();
      if (!r.ok) { setMsg({ texto: d.error || t("wa.falhouLer"), erro: true }); return; }
      setPrevia({ linhas: d.linhas ?? [], naoLidas: d.naoLidas ?? [], semana: d.semana ?? null });
      if (d.semana) setSemana(String(d.semana));
    } finally { setOcupado(false); }
  }

  async function confirmar() {
    setOcupado(true); setMsg(null);
    try {
      const r = await fetch("/api/hr/submissions/from-text", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, text: texto, year: ano, weekNo: Number(semana) || null, confirm: true }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ texto: d.chave ? t(d.chave) : (d.error || t("wa.falhouGravar")), erro: true });
        return;
      }
      setMsg({ texto: t("wa.gravado", { n: String(d.criadas), semCasar: String(d.semCasar) }) });
      setPrevia(null); setTexto("");
      onGravado();
    } finally { setOcupado(false); }
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-lg font-semibold">{t("wa.titulo")}</h2>
      <p className="mt-1 text-sm text-muted">{t("wa.ajuda")}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
        <label className="flex flex-col leading-tight">
          <span className="label">{t("wa.cliente")}</span>
          <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setPrevia(null); }}>
            <option value="">—</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.client_code ? `${c.client_code} · ` : ""}{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col leading-tight">
          <span className="label">{t("wa.semana")}</span>
          {/*
            A semana é obrigatória para gravar, e não se adivinha: horas
            lançadas na semana errada saem num recibo errado e só aparecem
            quando alguém reclama o salário.
          */}
          <input type="number" min="1" max="53" className="input tnum" value={semana}
            onChange={(e) => setSemana(e.target.value)} />
        </label>
      </div>

      <label className="mt-3 flex flex-col leading-tight">
        <span className="label">{t("wa.mensagem")}</span>
        <textarea className="input min-h-[120px] font-mono text-[13px]" value={texto}
          placeholder={"Semana 36\nJoão 39\nMaria - 42.5h\nPedro 38 (4 domingo)"}
          onChange={(e) => { setTexto(e.target.value); setPrevia(null); }} />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-ghost h-9 px-4 text-sm" onClick={ler} disabled={ocupado || !texto.trim()}>
          {t("wa.ler")}
        </button>
        {previa && previa.linhas.length > 0 && (
          <button className="btn-primary h-9 px-4 text-sm" onClick={confirmar} disabled={ocupado}>
            {t("wa.confirmar", { n: String(previa.linhas.length) })}
          </button>
        )}
      </div>

      {previa && (
        <div className="mt-4">
          {previa.linhas.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                    <th className="px-2 py-2 text-left font-medium">{t("wa.colNome")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("wa.colTotal")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("wa.colNormais")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("wa.colDomingo")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("wa.colFeriado")}</th>
                    <th className="px-2 py-2 text-left font-medium">{t("wa.colOrigem")}</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.linhas.map((l, i) => (
                    <tr key={i} className={`border-b border-line/50 ${l.trabalhou ? "" : "text-muted"}`}>
                      <td className="px-2 py-1.5">{l.nome}</td>
                      {/*
                        * O TOTAL e as NORMAIS lado a lado, e não só um número.
                        *
                        * "38 (4 domingo)" grava 34 + 4, porque as colunas somam-se
                        * no bruto. Quem confere tem de ver essa conta, senão o 34
                        * parece um erro de leitura.
                        */}
                      <td className="px-2 py-1.5 text-right tnum text-muted">{l.horas ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{l.horasNormais ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{l.horasDomingo ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tnum">{l.horasFeriado ?? "—"}</td>
                      {/* O original, ao lado. Quem confere compara em vez de confiar. */}
                      <td className="px-2 py-1.5 font-mono text-[11px] text-muted">
                        {l.origem}
                        {l.aviso && (
                          <span className="ml-2 font-sans text-warning">{t(l.aviso as any)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {previa.naoLidas.length > 0 && (
            <div className="mt-3 rounded-xl border border-warning/40 bg-warning-50 px-4 py-2.5 text-sm">
              <p className="font-medium">{t("wa.naoLidas", { n: String(previa.naoLidas.length) })}</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11.5px] text-muted">
                {previa.naoLidas.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {msg && <p className={`mt-3 text-sm ${msg.erro ? "text-danger" : "text-success"}`}>{msg.texto}</p>}
    </section>
  );
}
