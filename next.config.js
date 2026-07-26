/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
