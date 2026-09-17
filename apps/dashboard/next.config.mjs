/** @type {import('next').NextConfig} */
const nextConfig = {
  // Reads happen only in server components / route handlers (RLS-scoped `pg.Pool`); nothing
  // here ships credentials or query logic to the client.
  reactStrictMode: true,
  webpack: (config) => {
    // pdfkit's font-embedding path (fontkit -> restructure) optionally requires `iconv-lite`
    // for exotic encodings; the export route only ever uses standard-14 fonts (Helvetica,
    // Courier), so that path never actually runs, but webpack still warns about the
    // unresolved static require. Harmless — silenced so real warnings don't get lost in it.
    config.ignoreWarnings = [
      { module: /fontkit|restructure/, message: /Can't resolve 'iconv-lite'/ },
    ];
    return config;
  },
};

export default nextConfig;
