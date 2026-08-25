import ScreenSkeleton from "@/components/ScreenSkeleton";

/**
 * Sem este ficheiro, o Next deixa a tela ANTERIOR no ecrã até a nova estar
 * pronta — e a aplicação parece congelada a cada clique no menu.
 * Ver components/ScreenSkeleton.tsx.
 */
export default function Loading() {
  return <ScreenSkeleton />;
}
