import { redirect } from "next/navigation";

/**
 * A antiga "Visão geral" foi absorvida pelo Painel: as duas respondiam à mesma
 * pergunta, e a pessoa tinha de abrir as duas para ter a resposta inteira.
 *
 * O redirecionamento fica porque este é o endereço do cliente — o link que está
 * na lista, nos favoritos e em qualquer lugar que já aponte para cá.
 */
export default function ClientHome({ params }: { params: { id: string } }) {
  redirect(`/clients/${params.id}/dashboard`);
}
