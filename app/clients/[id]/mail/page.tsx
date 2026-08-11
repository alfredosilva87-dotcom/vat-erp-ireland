import { redirect } from "next/navigation";

// A entrada por e-mail virou uma seção do Cadastro, junto das filiais e dos
// dados da empresa — é tudo configuração que se faz uma vez.
export default function MailMoved({ params }: { params: { id: string } }) {
  redirect(`/clients/${params.id}/settings`);
}
