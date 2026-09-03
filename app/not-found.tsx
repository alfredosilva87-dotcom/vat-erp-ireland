import Link from "next/link";

/**
 * O 404 do produto — com layout, e com uma saída.
 *
 * Existia um caminho que devolvia a palavra `Not found` numa página branca,
 * sem `<title>`, sem menu e sem link de regresso: `/console` numa instalação
 * de cliente, onde o bloqueio é deliberado e correcto (a ferramenta de quem
 * vende não fica pendurada dentro do produto do cliente). O que estava mal não
 * era o bloqueio — era a FORMA. Quem lá chega por engano fica sem nada em que
 * carregar a não ser o botão "voltar" do navegador.
 *
 * Não diz o que estava lá nem porque foi recusado. Um 404 que explica o que
 * existe do outro lado deixa de ser um 404.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-display text-5xl font-semibold tracking-tight text-muted">404</p>
      <h1 className="font-display text-xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm text-muted">
        This address does not exist in this installation. It may have been moved, or it may
        belong to a part of the system that is not enabled here.
      </p>
      <Link href="/" className="btn-primary h-9 px-4 text-sm">Back to the dashboard</Link>
    </div>
  );
}
