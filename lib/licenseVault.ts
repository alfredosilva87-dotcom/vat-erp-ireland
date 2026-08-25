import "server-only";
import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { buildPayload, issueLicenseKey, type LicensePayload } from "@/lib/licenseKey";

/**
 * O cofre de quem VENDE: a chave privada e o registo do que já foi emitido.
 *
 * Mesmos ficheiros que a linha de comando (`selfhost/scripts/license-issue.js`)
 * usa — de propósito. O painel não é um segundo sistema de licenças; é outra
 * porta para o mesmo. Emitir pelo ecrã e listar pelo terminal têm de mostrar
 * exatamente a mesma coisa, senão um dia as duas listas discordam e não há
 * como saber qual está certa.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ISTO É SEGURO NUMA INSTALAÇÃO DE CLIENTE
 *
 * O mesmo código é instalado no cliente. O que não é instalado é a CHAVE
 * PRIVADA, que fica só na sua máquina. Sem o ficheiro, `available()` devolve
 * falso e a rota do painel responde 404 — a instalação do cliente nem admite
 * que a funcionalidade existe.
 *
 * A instalação dele tem apenas a chave PÚBLICA, embutida em `lib/licenseKey.ts`,
 * com a qual se confere uma assinatura mas nunca se produz uma nova.
 * ---------------------------------------------------------------------------
 */

const DIR = process.env.LICENSE_HOME || path.join(os.homedir(), ".vat-erp-license");
const PRIV = path.join(DIR, "private.pem");
const LEDGER = path.join(DIR, "issued.jsonl");

export type LicencaEmitida = {
  id: string; slug: string; name: string; months: number;
  issued: string; expires: string; key: string;
};

/** Há chave privada nesta máquina? Sem ela não se emite nada. */
export function available(): boolean {
  try { return fs.existsSync(PRIV); } catch { return false; }
}

export function issue(input: { slug: string; name?: string; months: number }): LicencaEmitida {
  if (!available()) throw new Error("Nao ha chave privada nesta maquina.");

  const payload: LicensePayload = buildPayload({
    slug: input.slug, name: input.name || undefined,
    months: input.months, id: randomBytes(4).toString("hex"),
  });
  const key = issueLicenseKey(payload, fs.readFileSync(PRIV, "utf8"));

  const entrada: LicencaEmitida = {
    id: payload.id, slug: payload.c, name: input.name || "",
    months: input.months, issued: payload.i, expires: payload.e, key,
  };

  /*
   * Gravado ANTES de devolver.
   *
   * Se o navegador fechar ou o e-mail se perder, a chave continua recuperável
   * na lista. Uma licença emitida e não registada é uma licença que existe no
   * mundo e que você não sabe que existe.
   */
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(LEDGER, JSON.stringify(entrada) + "\n", { mode: 0o600 });
  try { fs.chmodSync(LEDGER, 0o600); } catch { /* FS sem permissão POSIX */ }

  return entrada;
}

/** O histórico, do mais recente para o mais antigo. */
export function list(): { entries: LicencaEmitida[]; unreadable: number } {
  if (!fs.existsSync(LEDGER)) return { entries: [], unreadable: 0 };
  const entries: LicencaEmitida[] = [];
  let unreadable = 0;
  // Linha ilegível não derruba a leitura: uma edição manual malfeita tem de
  // aparecer como problema, e não sumir em silêncio.
  for (const line of fs.readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { unreadable++; }
  }
  return { entries: entries.reverse(), unreadable };
}
