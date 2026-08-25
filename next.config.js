/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pasta de saída, por variável de ambiente.
  //
  // `next dev` e `next start` NÃO podem partilhar a mesma `.next`: o servidor
  // de desenvolvimento recompila e reescreve os chunks que o de produção já
  // carregou, e o resultado é `Cannot read properties of undefined (reading
  // 'call')` em rotas que estão perfeitas — um erro que não aponta para nada
  // e faz perder uma tarde. Com isto dá para medir e conferir um build de
  // produção sem derrubar o dev:
  //
  //   NEXT_DIST_DIR=.next-prod npm run build
  //   NEXT_DIST_DIR=.next-prod npx next start -p 3001
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The server deployment builds the app into a Docker image and needs the
  // self-contained output. Kept behind a flag so the per-PC installer, which
  // runs `next start` from the repo, keeps working exactly as before.
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
  experimental: {
    // imapflow abre socket TLS e mailparser carrega tabelas de codificação por
    // require dinâmico: empacotados pelo webpack, os dois quebram em tempo de
    // execução em vez de na compilação, que é o pior momento para descobrir.
    serverComponentsExternalPackages: ["pdf-parse", "imapflow", "mailparser"],
  },
  webpack: (config) => {
    // tesseract.js is an OPTIONAL offline fallback kept external so the app
    // builds without it installed; it is require()d lazily at runtime.
    config.externals = config.externals || [];
    config.externals.push({ "tesseract.js": "commonjs tesseract.js" });
    return config;
  },
};

module.exports = nextConfig;
