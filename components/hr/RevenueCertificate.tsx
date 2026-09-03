"use client";

/**
 * O ECRÃ POR ONDE O CERTIFICADO DO ROS ENTRA.
 *
 * ---------------------------------------------------------------------------
 * PORQUE ESTE ECRÃ EXISTE, EM VEZ DE UMA VARIÁVEL DE AMBIENTE
 *
 * Foi pedido assim, e está certo: quem instala isto no escritório não vai
 * editar ficheiros num servidor. O ficheiro `.p12` que o ROS entrega é largado
 * aqui, a senha abre-o uma vez, e a partir daí ninguém volta a precisar dela.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM DOS PASSOS É A ORDEM DO ENSAIO
 *
 * 1. Escolher o ambiente — **teste primeiro**, sempre.
 * 2. Importar o certificado.
 * 3. **Testar a ligação** com um empregador e, se quiser, um só funcionário.
 * 4. Só depois disto passar a produção.
 *
 * O passo 3 existe porque a alternativa é descobrir que o certificado não
 * serve a meio de uma folha, na semana do pagamento. Aqui é uma linha
 * vermelha; lá é uma crise.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

type Ambiente = "test" | "production";

interface Credencial {
  ambiente: Ambiente;
  agentTain: string | null;
  titular: string | null;
  emissor: string | null;
  impressao: string;
  validoAte: string | null;
  diasAteExpirar: number | null;
  ultimoTesteEm: string | null;
  ultimoTesteOk: boolean | null;
  ultimoTesteMensagem: string | null;
}

/** Abaixo disto, avisa-se: renovar um certificado do ROS não é imediato. */
const AVISAR_A_DIAS = 30;

export default function RevenueCertificate() {
  const { t } = useT();
  const [cofrePronto, setCofrePronto] = useState(true);
  const [creds, setCreds] = useState<Credencial[]>([]);
  const [ambiente, setAmbiente] = useState<Ambiente>("test");
  const [senha, setSenha] = useState("");
  const [agentTain, setAgentTain] = useState("");
  const [empregador, setEmpregador] = useState("");
  const [msg, setMsg] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const ficheiroRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    const d = await (await fetch("/api/revenue/credential", { cache: "no-store" })).json();
    setCofrePronto(Boolean(d.cofrePronto));
    setCreds(d.credenciais ?? []);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const doAmbiente = creds.find((c) => c.ambiente === ambiente);

  async function importar() {
    const f = ficheiroRef.current?.files?.[0];
    if (!f) { setMsg({ texto: t("rev.faltaFicheiro"), erro: true }); return; }
    if (!senha) { setMsg({ texto: t("rev.faltaSenha"), erro: true }); return; }

    setOcupado(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("p12", f);
      fd.append("password", senha);
      fd.append("environment", ambiente);
      fd.append("agentTain", agentTain);
      const r = await fetch("/api/revenue/credential", { method: "POST", body: fd });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setMsg({ texto: d?.error === "cofreNaoConfigurado" ? t("rev.cofreNaoConfigurado") : (d?.error || t("rev.falhouImportar")), erro: true });
        return;
      }
      setMsg({ texto: t("rev.importado", { titular: d.titular, dias: String(d.diasAteExpirar) }) });
      /*
       * A senha é limpa do ecrã ASSIM QUE serve.
       *
       * Ela nunca sai daqui para lado nenhum — mas deixá-la escrita num campo
       * de um computador partilhado, depois de já não fazer falta, é deixá-la
       * à vista sem razão nenhuma.
       */
      setSenha("");
      if (ficheiroRef.current) ficheiroRef.current.value = "";
      await carregar();
    } finally { setOcupado(false); }
  }

  async function testar() {
    if (!empregador.trim()) { setMsg({ texto: t("rev.faltaEmpregador"), erro: true }); return; }
    setOcupado(true); setMsg(null);
    try {
      const r = await fetch("/api/revenue/test", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: ambiente, employerRegistrationNumber: empregador.trim() }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { setMsg({ texto: d?.error || t("rev.falhouTeste"), erro: true }); return; }
      if (d.ok) setMsg({ texto: t("rev.testeOk", { n: String(d.recebidos) }) });
      else setMsg({ texto: t((d.falha?.chave ?? "rev.errOutro") as any), erro: true });
      await carregar();
    } finally { setOcupado(false); }
  }

  async function remover(a: Ambiente) {
    if (!confirm(t("rev.removerConfirma"))) return;
    setOcupado(true);
    try {
      await fetch(`/api/revenue/credential?environment=${a}`, { method: "DELETE" });
      await carregar();
    } finally { setOcupado(false); }
  }

  return (
    <section className="card p-5">
      <h2 className="font-display text-lg font-semibold">{t("rev.title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("rev.subtitle")}</p>

      {!cofrePronto && (
        <div className="mt-3 rounded-xl border border-danger/40 bg-danger-50 px-4 py-3 text-sm">
          <p className="font-medium text-danger">{t("rev.cofreNaoConfigurado")}</p>
        </div>
      )}

      {/* O que já está lá dentro, por ambiente. Nunca o certificado — só o que ele diz de si. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(["test", "production"] as Ambiente[]).map((a) => {
          const c = creds.find((x) => x.ambiente === a);
          const expiraCedo = c?.diasAteExpirar != null && c.diasAteExpirar <= AVISAR_A_DIAS;
          return (
            <div key={a} className={`rounded-xl border p-3 text-sm ${c ? "border-line" : "border-dashed border-line"}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{a === "test" ? t("rev.ambTeste") : t("rev.ambProducao")}</span>
                {c
                  ? <span className="chip-ok text-[11px]">{t("rev.instalado")}</span>
                  : <span className="chip bg-surface-2 border border-line text-muted text-[11px]">{t("rev.vazio")}</span>}
              </div>
              {c && (
                <>
                  <p className="mt-1.5 truncate text-muted" title={c.titular ?? ""}>{c.titular}</p>
                  <p className="text-[11px] text-muted">{t("rev.impressao")}: <span className="font-mono">{c.impressao.slice(0, 23)}…</span></p>
                  <p className={`text-[12px] ${expiraCedo ? "text-warning font-medium" : "text-muted"}`}>
                    {t("rev.validoAte")}: {c.validoAte?.slice(0, 10)}
                    {c.diasAteExpirar != null && ` (${t("rev.emDias", { n: String(c.diasAteExpirar) })})`}
                  </p>
                  {c.ultimoTesteEm && (
                    <p className={`mt-1 text-[12px] ${c.ultimoTesteOk ? "text-success" : "text-danger"}`}>
                      {t("rev.ultimoTeste")}: {c.ultimoTesteEm.slice(0, 16).replace("T", " ")} — {c.ultimoTesteMensagem}
                    </p>
                  )}
                  {!c.ultimoTesteEm && (
                    <p className="mt-1 text-[12px] text-warning">{t("rev.porTestar")}</p>
                  )}
                  <button className="btn-ghost mt-2 h-7 px-2 text-[11px] text-danger" onClick={() => remover(a)} disabled={ocupado}>
                    {t("common.remove")}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* 1 e 2 — o ambiente e o ficheiro */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col leading-tight">
          <span className="label">{t("rev.ambiente")}</span>
          <select className="input" value={ambiente} onChange={(e) => setAmbiente(e.target.value as Ambiente)}>
            <option value="test">{t("rev.ambTeste")}</option>
            <option value="production">{t("rev.ambProducao")}</option>
          </select>
        </label>
        <label className="flex flex-col leading-tight">
          <span className="label">{t("rev.ficheiro")}</span>
          <input ref={ficheiroRef} type="file" accept=".p12,.pfx" className="input h-10 py-1.5 text-xs" />
        </label>
        <label className="flex flex-col leading-tight">
          <span className="label">{t("rev.senha")}</span>
          {/*
            A senha é escrita, usada e esquecida. Não vai para a base de dados,
            não volta em nenhuma resposta, e o campo é limpo assim que serve.
          */}
          <input type="password" className="input" value={senha} autoComplete="off"
            onChange={(e) => setSenha(e.target.value)} />
        </label>
        <label className="flex flex-col leading-tight">
          <span className="label">{t("rev.agentTain")}</span>
          <input className="input" value={agentTain} placeholder="11221W"
            onChange={(e) => setAgentTain(e.target.value.toUpperCase())} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary h-9 px-4 text-sm" onClick={importar} disabled={ocupado || !cofrePronto}>
          {ocupado ? t("common.saving") : t("rev.importar")}
        </button>
      </div>

      {/* 3 — o ensaio */}
      <div className="mt-5 rounded-xl border border-line bg-surface-2/50 p-4">
        <p className="text-sm font-medium">{t("rev.testarTitulo")}</p>
        <p className="mt-0.5 text-xs text-muted">{t("rev.testarAjuda")}</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col leading-tight">
            <span className="label">{t("rev.empregador")}</span>
            <input className="input font-mono" value={empregador} placeholder="3980609P"
              onChange={(e) => setEmpregador(e.target.value.toUpperCase())} />
          </label>
          <button className="btn-ghost h-9 px-4 text-sm" onClick={testar} disabled={ocupado || !doAmbiente}>
            {t("rev.testar")}
          </button>
        </div>
        {!doAmbiente && <p className="mt-2 text-xs text-muted">{t("rev.testarSemCert")}</p>}
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.erro ? "text-danger" : "text-success"}`}>{msg.texto}</p>
      )}
    </section>
  );
}
