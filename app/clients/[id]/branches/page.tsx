import { redirect } from "next/navigation";

// Filiais viraram uma seção do Cadastro. O redirecionamento evita que um link
// antigo (favorito, aba aberta) caia em página inexistente.
export default function BranchesMoved({ params }: { params: { id: string } }) {
  redirect(`/clients/${params.id}/settings`);
}
