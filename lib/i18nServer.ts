import "server-only";
import { cookies } from "next/headers";
import en from "@/lib/i18n/en";
import pt from "@/lib/i18n/pt";
import es from "@/lib/i18n/es";
import { DEFAULT_LANG, LANG_KEY, isLang, type Lang } from "@/lib/i18n/languages";

/**
 * TRADUZIR NO SERVIDOR.
 *
 * ---------------------------------------------------------------------------
 * POR QUE É QUE ISTO PRECISA DE EXISTIR
 *
 * Até aqui tudo o que era texto passava pelo `useT()` do navegador, e o
 * servidor só mandava chaves. Um PDF não pode fazer isso: ele nasce pronto no
 * servidor e é entregue como bytes, não há um segundo passo onde alguém
 * traduza.
 *
 * A alternativa — escrever o recibo em inglês e pronto — falhava justamente
 * para quem mais precisa dele. Metade das pessoas cujos recibos este escritório
 * emite fala português ou espanhol, e o payslip é o documento com que elas
 * conferem o próprio salário.
 *
 * O idioma vem do MESMO cookie que pinta as telas (`app/layout.tsx` lê-o para
 * o primeiro paint), portanto o recibo sai no idioma em que a pessoa estava a
 * trabalhar, sem uma segunda preferência para manter em dia.
 *
 * A resolução é chave a chave contra o inglês, tal como no cliente: um
 * dicionário incompleto devolve a frase inglesa naquela chave, e nunca um
 * espaço em branco no meio de um documento.
 */

const DICTS: Partial<Record<Lang, Partial<Record<string, string>>>> = {
  en: en as Record<string, string>,
  pt: pt as Record<string, string>,
  es: es as Record<string, string>,
};

export type Traduzir = (chave: string, vars?: Record<string, string | number>) => string;

/** O idioma do pedido, pelo cookie. Sem cookie, inglês. */
export function idiomaDoPedido(): Lang {
  try {
    const v = cookies().get(LANG_KEY)?.value;
    return isLang(v) ? v : DEFAULT_LANG;
  } catch {
    // Fora de um pedido (um script, um teste) não há cookies — e isso não é
    // motivo para rebentar um relatório.
    return DEFAULT_LANG;
  }
}

export function tradutor(lang: Lang = idiomaDoPedido()): Traduzir {
  const dict = DICTS[lang] ?? {};
  const base = DICTS.en ?? {};
  return (chave, vars) => {
    // A própria chave como último recurso: um texto que falta vê-se, e uma
    // string vazia no meio de um PDF não se vê.
    let s = dict[chave] ?? base[chave] ?? chave;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    }
    return s;
  };
}
