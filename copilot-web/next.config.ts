import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deploy tras proxy de CodePods: el proxy STRIPPEA el prefijo público
  // (/api/proxy/copilot-web/copilot-web), así que el routing del server va
  // en raíz, pero el navegador necesita URLs con el prefijo público:
  //  - ASSET_PREFIX: prefija /_next/* en el HTML servido
  //  - NEXT_PUBLIC_BASE_PATH: prefija los fetch del cliente (src/lib/api.ts)
  assetPrefix: process.env.ASSET_PREFIX || undefined,
  // canonicaliza CON barra final: la URL que expone CodePods casa sin
  // redirecciones que el proxy no resolvería
  trailingSlash: true,
  // 1 worker de build (el contenedor tiene pids.max=256 y vivimos al límite)
  experimental: { cpus: 1 },
};

export default nextConfig;