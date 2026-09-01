"use client";

import { useCallback, useEffect, useState } from "react";
import {
  abrirChave, emitir, esquecerChave, guardarChave, importarChave,
  montarCarga, temChaveGuardada,
} from "@/lib/licenseConsole";
import { MARCA } from "@/lib/marca";

/**
 * O console de licenças — a ferramenta de QUEM VENDE, fora do produto.
 *
 * Antes o painel de emissão vivia dentro do ERP, ou seja, dentro da instalação
 * de um cliente. Isso obrigava a estar naquela máquina para emitir, e no dia
 * em que houvesse um segundo escritório o painel continuaria preso no
 * primeiro. Aqui ele é uma página à parte, publicável onde se quiser.
 *
 * ---------------------------------------------------------------------------
 * O SERVIDOR QUE HOSPEDA ISTO NÃO TEM SEGREDO NENHUM
 *
 * A chave privada nunca sai deste navegador: fica guardada cifrada com uma
 * senha e a assinatura acontece no aparelho, com WebCrypto. Quem invadir a
 * hospedagem não leva nada que permita emitir uma licença.
 *
 * A consequência a aceitar: o histórico também vive aqui. Por isso há
 * exportação para o mesmo formato do `~/.vat-erp-license/issued.jsonl` — o
 * ficheiro no seu computador continua a ser o registo definitivo.
 * ---------------------------------------------------------------------------
 */

type Emitida = {
  id: string; slug: string; name: string; months: number;
  issued: string; expires: string; key: string;
};

const REGISTO = "vat-license-console-ledger";

export default function ConsolePage() {
  const [temChave, setTemChave] = useState(false);
  const [senha, setSenha] = useState("");
  const [pem, setPem] = useState("");
  const [chave, setChave] = useState<CryptoKey | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [slug, setSlug] = useState("");
  const [nome, setNome] = useState("");
  const [meses, setMeses] = useState(12);
  const [nova, setNova] = useState<Emitida | null>(null);
  const [registo, setRegisto] = useState<Emitida[]>([]);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    setTemChave(temChaveGuardada());
    try {
      const cru = localStorage.getItem(REGISTO);
      if (cru) setRegisto(JSON.parse(cru));
    } catch { /* registo ilegível: começa vazio, a exportação do Mac reconstrói */ }
  }, []);

  const gravarRegisto = useCallback((lista: Emitida[]) => {
    setRegisto(lista);
    try { localStorage.setItem(REGISTO, JSON.stringify(lista)); } catch { /* cheio */ }
  }, []);

  async function destrancar() {
    setOcupado(true); setErro(null);
    try {
      setChave(await importarChave(await abrirChave(senha)));
      setSenha("");
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  }

  async function instalar() {
    setOcupado(true); setErro(null);
    try {
      if (senha.length < 8) throw new Error("Escolha uma senha de pelo menos 8 caracteres.");
      // Importar ANTES de guardar: um PEM inválido tem de falhar agora, e não
      // na primeira emissão, quando já se acredita que está tudo pronto.
      const k = await importarChave(pem);
      await guardarChave(pem, senha);
      setChave(k); setTemChave(true); setPem(""); setSenha("");
    } catch (e: any) {
      setErro(e?.name === "DataError" ? "Isto não é uma chave privada Ed25519 em PKCS#8." : e.message);
    } finally { setOcupado(false); }
  }

  async function emitirLicenca() {
    if (!chave) return;
    setOcupado(true); setErro(null); setNova(null);
    try {
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug.trim().toLowerCase())) {
        throw new Error("Slug inválido: minúsculas, números e hífen.");
      }
      if (!Number.isInteger(meses) || meses < 1 || meses > 120) {
        throw new Error("Meses precisa ser inteiro entre 1 e 120.");
      }
      const carga = montarCarga({ slug: slug.trim().toLowerCase(), name: nome.trim(), months: meses });
      const texto = await emitir(carga, chave);
      const linha: Emitida = {
        id: carga.id, slug: carga.c, name: nome.trim(), months: meses,
        issued: carga.i, expires: carga.e, key: texto,
      };
      setNova(linha);
      gravarRegisto([linha, ...registo]);
    } catch (e: any) { setErro(e.message); } finally { setOcupado(false); }
  }

  async function copiar(texto: string, marca: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(marca);
      setTimeout(() => setCopiado(null), 2000);
    } catch { /* sem permissão: o texto está no ecrã */ }
  }

  const email = (e: Emitida) =>
    `Licença do ${MARCA.nome} — ${e.name || e.slug}\n\n`
    + `Validade: ${e.expires}\n\n`
    + `Para ativar: abra o sistema, vá a Configurações → Licença, cole a chave abaixo e clique Ativar.\n`
    + `A ativação acontece na própria instalação — não precisa de internet nem de ninguém entrar no sistema.\n\n`
    + `${e.key}\n`;

  function exportar() {
    // Mesmo formato do issued.jsonl: uma emissão por linha, para juntar ao
    // ficheiro do computador sem converter nada.
    const jsonl = registo.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const url = URL.createObjectURL(new Blob([jsonl], { type: "application/x-ndjson" }));
    const a = document.createElement("a");
    a.href = url; a.download = "issued.jsonl"; a.click();
    URL.revokeObjectURL(url);
  }

  async function importar(f: File) {
    const texto = await f.text();
    const lidas: Emitida[] = [];
    for (const l of texto.split("\n")) {
      if (!l.trim()) continue;
      try { lidas.push(JSON.parse(l)); } catch { /* linha ilegível: salta */ }
    }
    // Junta pelo id, sem duplicar o que já está aqui.
    const porId = new Map(registo.map((e) => [e.id, e]));
    for (const e of lidas) porId.set(e.id, e);
    gravarRegisto(Array.from(porId.values()).sort((a, b) => b.issued.localeCompare(a.issued)));
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Console de licenças</h1>
        <p className="mt-1 text-muted">
          A chave privada não sai deste navegador. A assinatura acontece aqui, no seu aparelho.
        </p>
      </header>

      {erro && <p className="mb-4 text-sm text-danger">{erro}</p>}

      {!chave && (
        <section className="card p-5">
          <h2 className="font-display text-lg font-semibold">
            {temChave ? "Destrancar" : "Instalar a chave neste aparelho"}
          </h2>
          {temChave ? (
            <>
              <p className="mt-1 text-sm text-muted">
                A chave está guardada aqui, cifrada. Escreva a senha para poder emitir.
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-1 flex-col leading-tight">
                  <span className="label">Senha</span>
                  <input type="password" className="input w-full" value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && destrancar()} />
                </label>
                <button className="btn-primary h-10 px-5 text-sm" disabled={ocupado || !senha} onClick={destrancar}>
                  {ocupado ? "…" : "Destrancar"}
                </button>
                <button className="btn-ghost h-10 px-4 text-sm"
                  onClick={() => { esquecerChave(); setTemChave(false); }}>
                  Esquecer a chave
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">
                Cole o conteúdo de <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                ~/.vat-erp-license/private.pem</code> e escolha uma senha. Ela fica guardada
                cifrada, só neste navegador — e a senha é a única forma de a abrir.
              </p>
              <textarea className="input mt-3 h-28 w-full font-mono text-[11px]"
                placeholder="-----BEGIN PRIVATE KEY-----" value={pem}
                onChange={(e) => setPem(e.target.value)} />
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-1 flex-col leading-tight">
                  <span className="label">Senha (mínimo 8)</span>
                  <input type="password" className="input w-full" value={senha}
                    onChange={(e) => setSenha(e.target.value)} />
                </label>
                <button className="btn-primary h-10 px-5 text-sm"
                  disabled={ocupado || !pem.trim() || !senha} onClick={instalar}>
                  {ocupado ? "…" : "Guardar neste aparelho"}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {chave && (
        <section className="card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-semibold">Emitir</h2>
            <span className="chip-ok text-[11px]">Chave destrancada</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_100px_auto] sm:items-end">
            <label className="flex flex-col leading-tight">
              <span className="label">Slug da empresa</span>
              <input className="input w-full font-mono text-[13px]" placeholder="precisetax"
                value={slug} onChange={(e) => setSlug(e.target.value)} />
            </label>
            <label className="flex flex-col leading-tight">
              <span className="label">Nome (só para conferir)</span>
              <input className="input w-full" value={nome} onChange={(e) => setNome(e.target.value)} />
            </label>
            <label className="flex flex-col leading-tight">
              <span className="label">Meses</span>
              <input type="number" min={1} max={120} className="input w-full"
                value={meses} onChange={(e) => setMeses(Number(e.target.value))} />
            </label>
            <button className="btn-primary h-10 px-5 text-sm" disabled={ocupado || !slug.trim()} onClick={emitirLicenca}>
              {ocupado ? "…" : "Emitir"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            O slug tem de ser exatamente o da instalação do cliente — é ele que amarra a chave.
          </p>
        </section>
      )}

      {nova && (
        <section className="card mt-4 border-l-4 border-l-success p-5">
          <h2 className="font-display text-lg font-semibold">
            {nova.name || nova.slug} — vale até <span className="tnum">{nova.expires}</span>
          </h2>
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

      <section className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
          <h2 className="font-display text-lg font-semibold">Emitidas neste aparelho</h2>
          <div className="flex flex-wrap gap-2">
            <label className="btn-ghost h-8 cursor-pointer px-3 text-xs">
              Importar registo
              <input type="file" accept=".jsonl,.json,.txt" className="hidden"
                onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])} />
            </label>
            <button className="btn-ghost h-8 px-3 text-xs" onClick={exportar} disabled={!registo.length}>
              Exportar issued.jsonl
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="row-hover w-full text-sm">
            <thead>
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 text-left font-medium">Emitida</th>
                <th className="px-4 py-2 text-left font-medium">Empresa</th>
                <th className="px-4 py-2 text-left font-medium">Slug</th>
                <th className="px-4 py-2 text-left font-medium">Vale até</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {registo.map((e) => (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="px-4 py-2 font-mono text-[12px] text-muted">{e.issued}</td>
                  <td className="px-4 py-2">{e.name || "—"}</td>
                  <td className="px-4 py-2 font-mono text-[12px]">{e.slug}</td>
                  <td className="px-4 py-2 font-mono text-[12px] tabular-nums">{e.expires}</td>
                  <td className="px-4 py-2 text-right">
                    <button className="btn-ghost h-7 px-2 text-[11px]" onClick={() => copiar(email(e), e.id)}>
                      {copiado === e.id ? "Copiado" : "Copiar e-mail"}
                    </button>
                  </td>
                </tr>
              ))}
              {registo.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">
                  Nada emitido neste aparelho. Importe o <code className="font-mono text-xs">issued.jsonl</code> do
                  seu computador para ver o histórico.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
