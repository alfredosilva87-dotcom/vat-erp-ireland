"use client";

/**
 * A ENTRADA — a primeira coisa que alguém vê do ACCENTRA.
 *
 * ---------------------------------------------------------------------------
 * O QUE MUDOU, E O QUE NÃO
 *
 * O Alfredo trouxe um desenho e pediu para chegar perto dele. O esqueleto já
 * era esse — painel da marca à esquerda, formulário à direita —, e o que
 * faltava era o que faz uma tela de entrada parecer um produto: o formulário
 * dentro de um cartão, os campos com ícone, a marca com peso, e a coluna da
 * esquerda a dizer o que o sistema faz em vez de o deixar por adivinhar.
 *
 * O QUE NÃO COPIEI, e porquê: o desenho tem um botão "Gerenciar minhas
 * empresas". Essa tela não existe, e um botão que não leva a lado nenhum na
 * primeira impressão do produto é pior do que não o haver. Entra quando a
 * tela existir.
 *
 * NENHUMA COR NOVA. Tudo sai das classes e dos tokens de globals.css — é a
 * regra desta casa, e é o que faz o tema escuro continuar a funcionar sem
 * ninguém se lembrar dele.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT, type TKey, LANGS, type Lang } from "@/lib/i18n";
import { MARCA } from "@/lib/marca";
import ThemeToggleButton from "@/components/ThemeToggleButton";

/** Traço fino, como o resto dos ícones do sistema. */
const S = {
  fill: "none", stroke: "currentColor", strokeWidth: 1.7,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const IconePredio = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}>
    <path d="M3 21h18M5 21V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v16M14 10h4a1 1 0 0 1 1 1v10" />
    <path d="M8 8h2M8 12h2M8 16h2M17 14h.01M17 17h.01" />
  </svg>
);
const IconePessoa = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}>
    <circle cx="12" cy="8" r="3.2" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </svg>
);
const IconeCadeado = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}>
    <rect x="4.5" y="10" width="15" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
const IconeOlho = ({ aberto }: { aberto: boolean }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.6" />
    {!aberto && <path d="M4 20 20 4" />}
  </svg>
);
const IconeEscudo = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}>
    <path d="M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6l7-3Z" /><path d="m9 12 2 2 4-4" />
  </svg>
);
const IconeSeta = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}><path d="M5 12h13M13 6l6 6-6 6" /></svg>
);
const IconeGlobo = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" {...S}>
    <circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c4 4.5 4 12.5 0 17M12 3.5c-4 4.5-4 12.5 0 17" />
  </svg>
);

/** O que o sistema faz, em cinco palavras — os módulos que existem mesmo. */
const MODULOS: { key: TKey; d: string }[] = [
  { key: "login.chipAccounting", d: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h4" },
  { key: "login.chipFinance", d: "M4 19h16M7 16V9M12 16V5M17 16v-4" },
  { key: "login.chipVat", d: "M6 6h12v12H6zM9 10h6M9 14h6" },
  { key: "login.chipPayroll", d: "M9 8a3 3 0 1 0 0-.01M3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-.01M15.5 20a5 5 0 0 1 5.5-4.9" },
  { key: "login.chipBanking", d: "M3 10h18M5 10V20M19 10V20M3 20h18M12 3l9 5H3l9-5Z" },
];

export default function Login() {
  const router = useRouter();
  const { t, lang, setLang } = useT();

  // Supabase's own redirect can land here instead of /reset-password when
  // the target URL isn't in the project's Auth "Redirect URLs" allow-list —
  // it falls back to the Site URL, and our middleware's own redirect (no
  // session on "/") preserves the URL fragment along the way. Rescue the
  // recovery token client-side regardless of that dashboard setting.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery") && hash.includes("access_token=")) {
      window.location.href = `/reset-password${hash}`;
    }
  }, []);

  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  /* Marcada por omissão: é exactamente o que este sistema sempre fez — sete
     dias. Ver `createSession`, onde está o que a caixa muda de facto. */
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setForgotSending(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      });
    } finally {
      setForgotSending(false);
      setForgotSent(true);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, company: company.trim() || undefined, remember }),
      });
      const data = await res.json();
      // The API returns an i18n key so the reason shows in the chosen language.
      if (!res.ok) throw new Error(data.messageKey ? t(data.messageKey as TKey) : (data.error || t("login.invalid")));
      const next = new URLSearchParams(window.location.search).get("next") || "/";
      router.push(next);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* ------------------------------------------------ o painel da marca */}
      <div className="painel-entrada relative hidden overflow-hidden bg-night lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(700px 400px at 15% 10%, rgb(var(--c-brand) / 0.38), transparent 60%), radial-gradient(600px 500px at 90% 90%, rgb(var(--c-violet) / 0.35), transparent 60%)",
          }}
        />
        {/*
          * A MARCA: símbolo, nome e descritor em texto.
          *
          * Tentei aqui o logótipo deitado e o Alfredo travou-o duas vezes — a
          * placa branca lia-se como um cartão a flutuar, e da segunda a imagem
          * nem carregava (a middleware redirecionava-a). O texto tem uma
          * vantagem que a imagem não tem: acompanha o tema e a língua.
          */}
        <div className="relative flex flex-col items-center gap-4 pt-6 text-center">
          <img src={MARCA.icone} alt={MARCA.nome} className="h-20 w-20 rounded-3xl shadow-brand" />
          <div>
            <div className="font-display text-4xl font-semibold tracking-[0.16em] text-night-ink">
              {MARCA.nome}
            </div>
            <div className="mt-1 text-[13px] font-medium tracking-wide text-brand-400">
              {MARCA.descritor}
            </div>
          </div>
          <span className="mt-2 h-px w-16 bg-night-ink/25" />
        </div>

        <div className="relative">
          <h1 className="max-w-md font-display text-[32px] font-semibold leading-[1.15] text-night-ink">
            {t("login.pitchTitle")}
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-night-muted">
            {t("login.pitchBody")}
          </p>

          {/*
            * Os módulos QUE EXISTEM, e não uma lista de promessas.
            *
            * Cada um destes é uma secção real do menu. Uma tela de entrada que
            * anuncia o que o produto não faz cria a primeira desconfiança
            * antes de a pessoa chegar a entrar.
            */}
          <div className="mt-8 flex flex-wrap gap-2.5">
            {MODULOS.map((m) => (
              <div key={m.key}
                className="flex w-[92px] flex-col items-center gap-2 rounded-xl2 border border-night-ink/10 bg-night-ink/[0.06] px-2 py-3 text-night-muted">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-400" {...S}><path d={m.d} /></svg>
                <span className="text-[11px] font-medium leading-none">{t(m.key)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-start gap-3">
          <span className="mt-0.5 rounded-lg border border-night-ink/10 bg-night-ink/[0.06] p-2 text-brand-400">
            <IconeEscudo />
          </span>
          <div>
            <div className="text-[13px] font-semibold text-night-ink">{t("login.trustTitle")}</div>
            <p className="text-[12.5px] text-night-muted">{t("login.trustBody")}</p>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- o formulário */}
      <div className="relative flex items-center justify-center bg-surface-2 px-6 pb-12 pt-24 lg:py-12">
        {/* Ambiente: tema e língua. Antes de entrar, quem lê mal a tela não
            tem por onde a mudar — e a língua é a primeira barreira. */}
        <div className="absolute right-6 top-6 flex items-center gap-2">
          <ThemeToggleButton />
          <label className="flex items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-[13px]">
            <span className="text-muted"><IconeGlobo /></span>
            <span className="sr-only">{t("login.language")}</span>
            <select
              className="cursor-pointer bg-transparent pr-1 text-[13px] font-medium outline-none"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
            >
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
        </div>

        <div className="w-full max-w-[420px]">
          {/* No telemóvel a coluna da marca não aparece; ela vem para aqui. */}
          <div className="mb-6 flex flex-col items-center gap-2 text-center lg:hidden">
            <img src={MARCA.icone} alt={MARCA.nome} className="h-14 w-14 rounded-2xl shadow-brand" />
            <div>
              <div className="font-display text-xl font-semibold tracking-[0.14em]">{MARCA.nome}</div>
              <div className="text-[11px] font-medium tracking-wide text-muted">{MARCA.descritor}</div>
            </div>
          </div>

          <div className="card p-7 sm:p-8">
            <p className="text-[13px] font-semibold text-brand">{t("login.welcomeBack")}</p>
            <h2 className="mt-1 font-display text-[26px] font-semibold tracking-tight">{t("login.title")}</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">{t("login.subtitle")}</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label className="label" htmlFor="company">{t("login.company")}</label>
                <ComIcone icone={<IconePredio />}>
                  <input
                    id="company" className="input pl-10" value={company} autoComplete="organization"
                    placeholder="precisetax"
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </ComIcone>
                <p className="mt-1 text-xs text-muted">{t("login.companyHelp")}</p>
              </div>

              <div>
                <label className="label" htmlFor="email">{t("login.email")}</label>
                <ComIcone icone={<IconePessoa />}>
                  <input
                    id="email" type="email" autoComplete="username" className="input pl-10"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com" required
                  />
                </ComIcone>
              </div>

              <div>
                <label className="label" htmlFor="password">{t("login.password")}</label>
                <ComIcone icone={<IconeCadeado />}>
                  <input
                    id="password" type={show ? "text" : "password"} autoComplete="current-password"
                    className="input pl-10 pr-11"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••" required
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? t("login.hide") : t("login.show")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:text-ink"
                  >
                    <IconeOlho aberto={show} />
                  </button>
                </ComIcone>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-[13px]" title={t("login.rememberHelp")}>
                  <input
                    type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-brand))]"
                    checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  />
                  {t("login.remember")}
                </label>
                <button
                  type="button"
                  className="text-[13px] font-medium text-brand hover:underline"
                  onClick={() => { setForgotOpen((v) => !v); setForgotSent(false); }}
                >
                  {t("login.forgotPassword")}
                </button>
              </div>

              {error && (
                <div className="rounded-xl border border-danger/30 bg-danger-50 px-4 py-2.5 text-sm text-danger" role="alert">
                  {error}
                </div>
              )}

              <button className="btn-primary flex w-full items-center justify-center gap-2 h-11" type="submit" disabled={loading}>
                {loading ? t("login.signingIn") : t("login.signIn")}
                {!loading && <IconeSeta />}
              </button>
            </form>

            {forgotOpen && (
              <div className="mt-4 rounded-xl border border-line bg-surface-2/60 p-4">
                {forgotSent ? (
                  <p className="text-sm text-muted">{t("login.forgotSent")}</p>
                ) : (
                  <form onSubmit={submitForgot} className="space-y-2">
                    <label className="label" htmlFor="forgot-email">{t("login.forgotEmail")}</label>
                    <input
                      id="forgot-email" type="email" className="input" value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="you@company.com" required
                    />
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button className="btn-primary h-9 flex-1 text-sm" type="submit" disabled={forgotSending}>
                        {forgotSending ? t("login.forgotSending") : t("login.forgotSubmit")}
                      </button>
                      <button type="button" className="btn-ghost h-9 px-3 text-sm" onClick={() => setForgotOpen(false)}>
                        {t("login.forgotCancel")}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-muted">{t("login.protected")}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Campo com ícone à esquerda.
 *
 * O ícone é decoração e não informação — o rótulo por cima é que diz o que o
 * campo é. Por isso `pointer-events-none`: clicar nele tem de cair no input,
 * como cai em qualquer sítio do campo.
 */
function ComIcone({ icone, children }: { icone: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{icone}</span>
      {children}
    </div>
  );
}
