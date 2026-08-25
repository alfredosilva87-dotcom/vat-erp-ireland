/**
 * O esqueleto que aparece ENQUANTO a tela seguinte carrega.
 *
 * Existe por causa de um comportamento do Next que se sente como avaria: sem
 * um `loading.tsx`, ele mantém a tela ANTIGA no ecrã até a nova estar pronta.
 * Quem clica não vê nada mudar — no servidor de desenvolvimento isso são dois
 * ou três segundos de aplicação aparentemente morta, e mesmo em produção são
 * uns 100 a 300 ms de clique sem resposta.
 *
 * O relógio não muda; o que muda é saber que o clique foi ouvido. É a diferença
 * entre "está a carregar" e "não funcionou" — e a segunda leitura faz a pessoa
 * clicar outra vez, o que só piora a espera.
 *
 * Sem animação de brilho de propósito: um pulso discreto basta para dizer
 * "estou a trabalhar" sem transformar cada navegação num espetáculo.
 */
export default function ScreenSkeleton({ linhas = 6 }: { linhas?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">A carregar…</span>

      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-4 w-80 animate-pulse rounded bg-surface-2/70" />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-line px-5 py-3">
          <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
        </div>
        <div className="divide-y divide-line/60">
          {Array.from({ length: linhas }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
              <div className="h-3.5 w-24 animate-pulse rounded bg-surface-2" />
              <div className="h-3.5 flex-1 animate-pulse rounded bg-surface-2/70" />
              <div className="h-3.5 w-20 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
