"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MARCA } from "@/lib/marca";

/**
 * Emitir licença e mandar para o cliente — sem entrar na instalação dele.
 *
 * A chave é assinada com a chave privada que vive nesta máquina e carrega a
 * própria verdade: para quem é, até quando vale. O cliente cola em
 * Configurações → Licença e a instalação dele confere a assinatura sozinha.
 *
 * Existe porque emitir era só linha de comando. A CLI continua a funcionar e
 * escreve no MESMO registo — esta tela é outra porta para o mesmo cofre, não
 * um segundo sistema.
 *
 * Se esta máquina não tiver a chave privada, a rota responde 404 e a tela diz
 * isso em voz alta em vez de mostrar um formulário que nunca vai funcionar.
 */

type Emitida = {
  id: string; slug: string; name: string; months: number;
  issued: string; expires: string; key: string;
};

export default function LicensesPage() {
  const [entries, setEntries] = useState<Emitida[]>([]);
  const [ilegiveis, setIlegiveis] = useState(0);
  const [semCofre, setSemCofre] = useState(false);
  const [semPermissao, setSemPermissao] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const [slug, setSlug] = useState("");
  const [nome, setNome] = useState("");
  const [meses, setMeses] = useState(12);
  const [emitindo, setEmitindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState<Emitida | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/master/licenses", { cache: "no-store" });
      if (r.status === 404) { setSemCofre(true); return; }
      /*
       * 403 tem de aparecer, e não virar lista vazia.
       *
       * Sem isto a tela dizia "Nada emitido ainda" quando a resposta era "não
       * pode" — a mesma frase para duas realidades opostas, e a errada é a que
       * faz procurar defeito onde não há. Acontece de verdade: o papel vem do
       * token, então uma conta acabada de promover a master continua a ser
       * `admin` para a API até sair e entrar de novo.
       */
      if (r.status === 403) { setSemPermissao(true); return; }
      if (!r.ok) { setErro(`A lista não carregou (HTTP ${r.status}).`); return; }
      const d = await r.json();
      setEntries(d.entries || []);
      setIlegiveis(d.unreadable || 0);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function emitir() {
    setEmitindo(true);
    setErro(null);
    setNova(null);
    try {
      const r = await fetch("/api/master/licenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, name: nome, months: meses }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Falhou.");
      setNova(d);
      await carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEmitindo(false);
    }
  }

  async function copiar(texto: string, marca: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(marca);
      setTimeout(() => setCopiado(null), 2000);
    } catch { /* sem permissão de área de transferência: o texto está no ecrã */ }
  }

  /** O e-mail pronto, para não haver de escrever a explicação de cada vez. */
  const email = (e: Emitida) =>
    `Licença do ${MARCA.nome} — ${e.name || e.slug}\n\n`
    + `Validade: ${e.expires}\n\n`
    + `Para ativar: abra o sistema, vá a Configurações → Licença, cole a chave abaixo e clique Ativar.\n`
    + `A ativação é feita na própria instalação — não é preciso internet nem que ninguém entre no sistema.\n\n`
    + `${e.key}\n`;

  if (semPermissao) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Licenças</h1>
        <div className="card border-l-4 border-l-warning p-5">
          <p className="text-sm">Esta tela é do perfil <b>master</b>, e a sua sessão não tem esse perfil.</p>
          <p className="mt-2 text-sm text-muted">
            Se o perfil foi alterado agora, saia e entre de novo: o papel viaja dentro da sessão e
            só muda no login seguinte.
          </p>
        </div>
      </div>
    );
  }

  if (semCofre) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Licenças</h1>
        <div className="card border-l-4 border-l-warning p-5">
          <p className="text-sm">
            Esta máquina não tem a chave privada de emissão, então não é daqui que se emitem licenças.
          </p>
          <p className="mt-2 text-sm text-muted">
            Na máquina de quem vende, gere o par de chaves uma única vez com{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
              node selfhost/scripts/license-keygen.js
            </code>{" "}
            e recarregue esta tela.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Licenças</h1>
          <p className="mt-1 text-muted">
            Emita a chave e mande por e-mail. O cliente ativa sozinho, sem ninguém entrar na instalação dele.
          </p>
        </div>
        <Link href="/master" className="btn-ghost h-9 px-4 text-sm">Empresas</Link>
      </div>

      <section className="card p-5">
        <h2 className="font-display text-lg font-semibold">Emitir</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px_auto] sm:items-end">
          <label className="flex flex-col leading-tight">
            <span className="label">Slug da empresa</span>
            <input className="input w-full font-mono text-[13px]" placeholder="precisetax"
              value={slug} onChange={(e) => setSlug(e.target.value)} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Nome (só para conferir)</span>
            <input className="input w-full" placeholder="Precise Tax and Accounting Solutions"
              value={nome} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label className="flex flex-col leading-tight">
            <span className="label">Meses</span>
            <input type="number" min={1} max={120} className="input w-full"
              value={meses} onChange={(e) => setMeses(Number(e.target.value))} />
          </label>
          <button className="btn-primary h-10 px-5 text-sm" disabled={emitindo || !slug.trim()} onClick={emitir}>
            {emitindo ? "…" : "Emitir"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          O slug precisa ser exatamente o da instalação do cliente — é ele que amarra a chave. Uma chave
          emitida para o slug errado não ativa em lugar nenhum.
        </p>
        {erro && <p className="mt-3 text-sm text-danger">{erro}</p>}
      </section>

      {nova && (
        <section className="card border-l-4 border-l-success p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">
              Emitida para {nova.name || nova.slug} — vale até <span className="tnum">{nova.expires}</span>
            </h2>
            <span className="chip bg-surface-2 font-mono text-[11px] text-muted">{nova.id}</span>
          </div>
          <textarea readOnly className="input mt-3 h-24 w-full break-all font-mono text-[11px]" value={nova.key} />
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-ghost h-9 px-4 text-sm" onClick={() => copiar(nova.key, "chave")}>
              {copiado === "chave" ? "Copiado" : "Copiar a chave"}
            </button>
            <button className="btn-primary h-9 px-4 text-sm" onClick={() => copiar(email(nova), "email")}>
              {copiado === "email" ? "Copiado" : "Copiar o e-mail pronto"}
            </button>
          </div>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-semibold">Emitidas</h2>
          {ilegiveis > 0 && (
            <span className="chip-warn text-[11px]">{ilegiveis} linha(s) ilegível(eis) no registo</span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-left font-medium">Emitida</th>
                <th className="px-4 py-2 text-left font-medium">Empresa</th>
                <th className="px-4 py-2 text-left font-medium">Slug</th>
                <th className="px-4 py-2 text-left font-medium">Vale até</th>
                <th className="px-4 py-2 text-right font-medium">Meses</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="px-4 py-2 font-mono text-[12px] text-muted">{e.issued}</td>
                  <td className="px-4 py-2">{e.name || "—"}</td>
                  <td className="px-4 py-2 font-mono text-[12px]">{e.slug}</td>
                  <td className="px-4 py-2 font-mono text-[12px] tabular-nums">{e.expires}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.months}</td>
                  <td className="px-4 py-2 text-right">
                    <button className="btn-ghost h-7 px-2 text-[11px]" onClick={() => copiar(email(e), e.id)}>
                      {copiado === e.id ? "Copiado" : "Copiar e-mail"}
                    </button>
                  </td>
                </tr>
              ))}
              {!carregando && entries.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">Nada emitido ainda.</td></tr>
              )}
              {carregando && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted">…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
