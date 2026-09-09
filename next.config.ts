import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sortie autonome : image Docker légère, démarrée par `node server.js`.
  output: "standalone",
};

export default nextConfig;
