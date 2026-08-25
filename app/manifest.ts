import type { MetadataRoute } from "next";

/**
 * Instalar como aplicativo: ícone próprio e janela sem barra de navegador.
 *
 * Sem service worker DE PROPÓSITO — este é um sistema contábil falando com o
 * banco ao vivo, e servir dado de cache parecendo estar no ar é pior que
 * mostrar que caiu. A instalação não depende dele: Chrome e Edge oferecem
 * "Instalar" só com o manifesto.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Identidade estável: sem `id`, mudar `start_url` faria o navegador tratar
    // como um app diferente e o usuário acabaria com dois ícones.
    id: "/?app=vat-reader",
    name: "VAT Reader — Ireland ERP",
    short_name: "VAT Reader",
    description: "Leitura de notas, VAT irlandês, clientes, créditos e obrigações.",
    start_url: "/?app=vat-reader",
    scope: "/",
    display: "standalone",
    orientation: "any",
    /*
     * Cor da tela de abertura e da barra da janela.
     *
     * Acompanha o tema CLARO, que é o padrão do app (ver o script de tema em
     * app/layout.tsx): as cores antigas eram o quase-preto `#0E0A20`, que
     * dava um flash escuro antes de a interface clara aparecer.
     */
    background_color: "#F8F7FE",
    theme_color: "#F8F7FE",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    /*
     * Atalhos do ícone (botão direito na Dock / Menu Iniciar) — o gesto de
     * aplicativo instalado: ir direto à rotina em vez de abrir e navegar.
     */
    shortcuts: [
      { name: "Analisar notas", short_name: "Analisar", url: "/analyze" },
      { name: "Caixa de entrada", short_name: "Entrada", url: "/inbox" },
      { name: "Clientes", short_name: "Clientes", url: "/clients" },
    ],
  };
}
