import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deploy behind a CodePods proxy: the proxy STRIPS the public prefix
  // (/api/proxy/copilot-web/copilot-web), so server routing runs at the
  // root, but the browser needs URLs carrying the public prefix:
  //  - ASSET_PREFIX: prefixes /_next/* in served HTML
  //  - NEXT_PUBLIC_BASE_PATH: prefixes client fetches (src/lib/api.ts)
  assetPrefix: process.env.ASSET_PREFIX || undefined,
  // canonicalizes with a trailing slash: the URL CodePods exposes matches with
  // redirects the proxy could not resolve
  trailingSlash: true,
  // 1 build worker (container has pids.max=256; we run close to the limit)
  experimental: { cpus: 1 },
};

export default nextConfig;