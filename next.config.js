/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The server deployment builds the app into a Docker image and needs the
  // self-contained output. Kept behind a flag so the per-PC installer, which
  // runs `next start` from the repo, keeps working exactly as before.
  output: process.env.BUILD_STANDALONE ? "standalone" : undefined,
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
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
