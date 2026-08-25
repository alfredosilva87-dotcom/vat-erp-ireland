import type { Client } from "@/lib/types";

/**
 * O registo do cliente, buscado uma vez e partilhado.
 *
 * O cabeçalho (`app/clients/[id]/layout.tsx`) e o menu de módulo
 * (`components/ModuleSidebar.tsx`) precisam do MESMO cliente e pediam-no cada
 * um por si. Duas consequências, e a segunda é a que se sente:
 *
 *   - dois pedidos idênticos por navegação (quatro em desenvolvimento, onde o
 *     `reactStrictMode` corre cada efeito duas vezes);
 *   - o nome da empresa piscava "Loading…" a CADA clique dentro do mesmo
 *     cliente, porque cada tela recomeçava do zero. É a maior parte da
 *     sensação de que o sistema trava ao mudar de tela — não é o tempo, é o
 *     conteúdo que desaparece e volta.
 *
 * Aqui o pedido em voo é partilhado e a resposta fica guardada por pouco
 * tempo. Curto de propósito: este é o cadastro que alguém acabou de editar na
 * tela ao lado, e um cache generoso mostraria o nome antigo. Quem grava chama
 * `invalidateClient` e a próxima leitura vai ao servidor.
 */

const TTL_MS = 30_000;

type Entrada = { quando: number; valor: Client | null };

const guardado = new Map<string, Entrada>();
const emVoo = new Map<string, Promise<Client | null>>();

/** O que já está em memória, sem ir à rede. Serve para pintar no 1º quadro. */
export function cachedClient(id: string): Client | null | undefined {
  const e = guardado.get(id);
  if (!e) return undefined;
  if (Date.now() - e.quando > TTL_MS) return undefined;
  return e.valor;
}

export function fetchClient(id: string): Promise<Client | null> {
  const pronto = cachedClient(id);
  if (pronto !== undefined) return Promise.resolve(pronto);

  // Dois componentes a montar no mesmo quadro partilham o pedido em voo, em
  // vez de abrirem dois.
  const jaPedido = emVoo.get(id);
  if (jaPedido) return jaPedido;

  const p = fetch(`/api/clients/${id}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.client ?? null) as Client | null)
    .then((c) => {
      guardado.set(id, { quando: Date.now(), valor: c });
      return c;
    })
    // Falha de rede não fica guardada: guardar `null` faria o cabeçalho
    // insistir em "sem cliente" durante os trinta segundos seguintes.
    .catch(() => null)
    .finally(() => { emVoo.delete(id); });

  emVoo.set(id, p);
  return p;
}

/** Depois de gravar. Sem id, esquece tudo. */
export function invalidateClient(id?: string) {
  if (id) { guardado.delete(id); emVoo.delete(id); }
  else { guardado.clear(); emVoo.clear(); }
}
