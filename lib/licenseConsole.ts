/**
 * Emissão de licença DENTRO DO NAVEGADOR, sem a chave privada tocar servidor.
 *
 * O painel de emissão precisava sair de dentro do produto: ele vivia na
 * instalação de um cliente, o que obrigava o Alfredo a estar naquela máquina
 * para emitir — e, quando houver um segundo escritório, o painel continuaria
 * preso no primeiro.
 *
 * A saída escolhida (2026-08-24): o painel vai para a nuvem, mas a chave
 * privada **não**. Ela fica guardada neste navegador, cifrada com uma senha
 * que só o Alfredo sabe, e a assinatura acontece aqui, no aparelho. O servidor
 * que hospeda a página não tem segredo nenhum — se for invadido, o invasor não
 * leva nada que permita emitir licença.
 *
 * O que sai daqui tem de ser byte a byte igual ao que `lib/licenseKey.ts`
 * produz no Node, senão a assinatura não confere na instalação do cliente. Por
 * isso a forma canônica é repetida aqui com a MESMA ordem de campos, e não
 * derivada de outra coisa.
 */

export type CargaDeLicenca = {
  v: 1; c: string; n?: string; e: string; i: string; id: string;
};

const PREFIXO = "VATERP1";

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * O que é assinado. Ordem de campos FIXA.
 *
 * Assinar `JSON.stringify` de um objeto montado noutra ordem daria uma
 * assinatura que não confere, e o sintoma apareceria só no cliente, ao ativar.
 */
export function canonico(carga: CargaDeLicenca): Uint8Array {
  const ordenado = { v: carga.v, c: carga.c, n: carga.n ?? "", e: carga.e, i: carga.i, id: carga.id };
  return new TextEncoder().encode(JSON.stringify(ordenado));
}

/** A carga de uma licença de N meses a partir de hoje. Igual ao `buildPayload`. */
export function montarCarga(input: { slug: string; name?: string; months: number }): CargaDeLicenca {
  const base = new Date();
  const expira = new Date(base);
  expira.setUTCMonth(expira.getUTCMonth() + input.months);
  const id = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return {
    v: 1,
    c: input.slug.toLowerCase(),
    n: input.name || undefined,
    e: expira.toISOString().slice(0, 10),
    i: base.toISOString().slice(0, 10),
    id,
  };
}

const derDoPem = (pem: string): Uint8Array => {
  const corpo = pem.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  const cru = atob(corpo);
  const out = new Uint8Array(cru.length);
  for (let i = 0; i < cru.length; i++) out[i] = cru.charCodeAt(i);
  return out;
};

/** A chave privada PEM (PKCS#8) como chave de assinatura do WebCrypto. */
export async function importarChave(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8", derDoPem(pem) as BufferSource, { name: "Ed25519" }, false, ["sign"]
  );
}

/** A chave de licença pronta para mandar ao cliente. */
export async function emitir(carga: CargaDeLicenca, chave: CryptoKey): Promise<string> {
  const corpo = canonico(carga);
  const assinatura = new Uint8Array(
    await crypto.subtle.sign({ name: "Ed25519" }, chave, corpo as BufferSource)
  );
  return `${PREFIXO}.${b64url(corpo)}.${b64url(assinatura)}`;
}

// ------------------------------------------------- guardar a chave com senha

/*
 * A chave fica no navegador CIFRADA, e nunca em texto puro.
 *
 * Guardá-la crua no `localStorage` faria qualquer script da página — e
 * qualquer pessoa que abrisse o aparelho — sair com o poder de emitir licença
 * para sempre. Com senha, o que está guardado sozinho não vale nada.
 *
 * PBKDF2 com muitas voltas porque a senha é o único segredo: o custo por
 * tentativa é o que torna a força bruta cara.
 */

const ARMAZEM = "vat-license-console-key";
const VOLTAS = 310_000;

async function chaveDaSenha(senha: string, sal: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(senha) as BufferSource, "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: sal as BufferSource, iterations: VOLTAS, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

export async function guardarChave(pem: string, senha: string): Promise<void> {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cofre = await chaveDaSenha(senha, sal);
  const cifrado = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource }, cofre, new TextEncoder().encode(pem) as BufferSource
  ));
  localStorage.setItem(ARMAZEM, JSON.stringify({
    sal: b64url(sal), iv: b64url(iv), dados: b64url(cifrado),
  }));
}

export const temChaveGuardada = (): boolean => {
  try { return localStorage.getItem(ARMAZEM) !== null; } catch { return false; }
};

export const esquecerChave = (): void => {
  try { localStorage.removeItem(ARMAZEM); } catch { /* sem armazenamento */ }
};

const deB64url = (s: string): Uint8Array => {
  const cru = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(cru.length);
  for (let i = 0; i < cru.length; i++) out[i] = cru.charCodeAt(i);
  return out;
};

/** Devolve o PEM, ou lança quando a senha está errada. */
export async function abrirChave(senha: string): Promise<string> {
  const cru = localStorage.getItem(ARMAZEM);
  if (!cru) throw new Error("Não há chave guardada neste navegador.");
  const { sal, iv, dados } = JSON.parse(cru);
  const cofre = await chaveDaSenha(senha, deB64url(sal));
  try {
    const aberto = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: deB64url(iv) as BufferSource }, cofre, deB64url(dados) as BufferSource
    );
    return new TextDecoder().decode(aberto);
  } catch {
    // AES-GCM falha na autenticação quando a senha está errada; a mensagem do
    // navegador é vazia e assustadora, então diz-se o que de facto aconteceu.
    throw new Error("Senha errada.");
  }
}
