import "server-only";
import pkg from "@/package.json";
import { maisAlta, compararComPublicada, type Novidade } from "@/lib/atualizacoesPuro";

/**
 * "Há versão nova?" — a pergunta que a instalação faz ao GitHub.
 *
 * A regra de comparação vive em `atualizacoesPuro.ts`. Aqui é a rede, o
 * segredo, e a cache.
 *
 * ---------------------------------------------------------------------------
 * O REPOSITÓRIO É PRIVADO, E ISSO MUDA TUDO
 *
 * A API do GitHub responde 404 (não 403) a um repositório privado sem
 * credencial — de propósito, para não revelar que ele existe. Sem tratar isso,
 * a tela diria "está actualizado" a uma instalação que nunca conseguiu
 * perguntar. **Um verificador que falha em silêncio é pior do que não haver
 * verificador**: dá a garantia sem a fazer.
 *
 * Por isso todo estado que não seja uma resposta boa é dito por palavras, e o
 * ecrã mostra-o.
 *
 * O TOKEN é de leitura e só do conteúdo (fine-grained, `Contents: read-only`).
 * Vive no `.env.local` da máquina do escritório, ao lado das outras chaves, e
 * **nunca chega ao navegador**: quem fala com o GitHub é esta função, no
 * servidor. Sem ele o resto do sistema funciona na mesma — só esta pergunta
 * fica sem resposta.
 */

export type Estado =
  | "ok"              // perguntou e obteve resposta
  | "sem-token"       // falta a credencial: não dá para perguntar a um repo privado
  | "sem-repo"        // falta dizer qual é o repositório
  | "nao-autorizado"  // token inválido, expirado, ou sem acesso a este repo
  | "sem-rede"        // não chegou lá (offline, firewall do escritório)
  | "sem-etiquetas";  // chegou, mas não há nenhuma versão publicada

export type Resultado = Novidade & {
  estado: Estado;
  /** O que dizer a quem está a olhar, quando `estado` não é "ok". */
  detalhe: string | null;
  /** Notas da versão, quando a publicação é uma Release e não só uma etiqueta. */
  notas: string | null;
  /** Para onde ir ver o que mudou. */
  url: string | null;
  verificadoEm: string;
};

/** A versão que ESTA instalação corre. */
export const VERSAO_INSTALADA = String((pkg as { version?: string }).version ?? "");

const REPO = process.env.UPDATE_REPO || "alfredosilva87-dotcom/vat-erp-ireland";
const TOKEN = process.env.UPDATE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";

/*
 * A cache, e por que ela não é opcional.
 *
 * O aviso monta em TODA a tela. Sem cache, cada navegação de cada utilizador
 * seria um pedido ao GitHub — o limite de 5000/hora de um token esgota-se num
 * escritório com cinco pessoas a trabalhar, e a partir daí o verificador
 * responde 403 a toda a gente. Uma vez por hora é mais do que suficiente para
 * uma coisa que muda de semana a semana.
 *
 * É memória do processo: reiniciar o servidor volta a perguntar, e isso é
 * exactamente o que se quer depois de uma actualização.
 */
const VALIDADE_MS = 60 * 60 * 1000;
let cache: { em: number; r: Resultado } | null = null;

const vazio = (estado: Estado, detalhe: string): Resultado => ({
  ...compararComPublicada(VERSAO_INSTALADA, null),
  estado, detalhe, notas: null, url: null,
  verificadoEm: new Date().toISOString(),
});

/**
 * A mesma parede vista de dois lados.
 *
 * Sem token, o 404 de um repositório privado é indistinguível de "não existe" —
 * o GitHub esconde-o de propósito. Com token, um 401/403/404 já é a credencial
 * a ser recusada. Dizer a coisa certa em cada caso é a diferença entre uma
 * mensagem accionável e um enigma.
 */
const semAcesso = (): Resultado => vazio(
  TOKEN ? "nao-autorizado" : "sem-token",
  TOKEN
    ? `O GitHub recusou a credencial para ${REPO} — expirou, ou não tem acesso a este repositório.`
    : `O GitHub não responde por ${REPO} sem credencial. Se o repositório é privado, é isto que se espera: `
      + "ponha UPDATE_GITHUB_TOKEN no .env.local — um token fine-grained com Contents: read-only.",
);

async function pedir(caminho: string): Promise<{ ok: boolean; status: number; corpo: any }> {
  const r = await fetch(`https://api.github.com/repos/${REPO}${caminho}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    // A leitura tem de ser fresca dentro da nossa cache, não da do Next.
    cache: "no-store",
    // Sem prazo, uma rede que engole o pedido em silêncio deixava o painel a
    // carregar para sempre — o firewall de um escritório faz exactamente isso.
    signal: AbortSignal.timeout(8000),
  });
  return { ok: r.ok, status: r.status, corpo: r.ok ? await r.json() : null };
}

export async function verificarAtualizacao(forcar = false): Promise<Resultado> {
  if (!forcar && cache && Date.now() - cache.em < VALIDADE_MS) return cache.r;

  if (!REPO) return vazio("sem-repo", "Falta dizer qual é o repositório (UPDATE_REPO no .env.local).");

  /*
   * PERGUNTA-SE PRIMEIRO, e só se pede credencial quando o GitHub a recusar.
   *
   * Exigir o token à cabeça parecia mais honesto e era pior: enquanto o
   * repositório for público a pergunta responde-se sem credencial nenhuma, e
   * uma verificação desligada à espera de um token que ninguém precisava de
   * criar é uma verificação que nunca correu. Quando ele passar a privado, o
   * GitHub responde 404 e é aí — e só aí — que se fala em token.
   */

  let r: Resultado;
  try {
    /*
     * A RELEASE primeiro, a etiqueta como recurso.
     *
     * A Release traz as notas — o que mudou —, e é isso que faz alguém decidir
     * actualizar hoje em vez de "um dia destes". Mas nem toda a entrega deste
     * projecto virou Release: as etiquetas existem desde a v1.7 e as Releases
     * podem não existir. Cair na lista de etiquetas garante que a pergunta tem
     * sempre resposta, mesmo sem notas.
     */
    const rel = await pedir("/releases/latest");
    if (rel.status === 401 || rel.status === 403) return guardar(semAcesso());

    if (rel.ok && rel.corpo?.tag_name) {
      const cmp = compararComPublicada(VERSAO_INSTALADA, rel.corpo.tag_name);
      r = {
        ...cmp, estado: "ok", detalhe: null,
        notas: rel.corpo.body || null,
        url: rel.corpo.html_url || null,
        verificadoEm: new Date().toISOString(),
      };
    } else {
      const tags = await pedir("/tags?per_page=100");
      if (tags.status === 401 || tags.status === 403) return guardar(semAcesso());
      if (tags.status === 404) return guardar(semAcesso());
      if (!tags.ok) return guardar(vazio("sem-rede", `O GitHub respondeu ${tags.status}.`));

      const alta = maisAlta(((tags.corpo ?? []) as any[]).map((t) => String(t.name)));
      if (!alta) return guardar(vazio("sem-etiquetas", "O repositório não tem nenhuma etiqueta de versão publicada."));

      const cmp = compararComPublicada(VERSAO_INSTALADA, alta.tag);
      r = {
        ...cmp, estado: "ok", detalhe: null, notas: null,
        url: `https://github.com/${REPO}/releases/tag/${alta.tag}`,
        verificadoEm: new Date().toISOString(),
      };
    }
  } catch (e: any) {
    // Offline, DNS, firewall, tempo esgotado. Não é erro do utilizador e não
    // impede nada — mas também não pode passar por "está actualizado".
    return guardar(vazio("sem-rede", `Não foi possível falar com o GitHub: ${e?.message ?? e}`));
  }

  return guardar(r);
}

function guardar(r: Resultado): Resultado {
  cache = { em: Date.now(), r };
  return r;
}
