const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.ignoreWarnings = [
      { module: /fontkit|restructure/, message: /Can't resolve 'iconv-lite'/ },
    ];
    return config;
  },
};

export default nextConfig;
