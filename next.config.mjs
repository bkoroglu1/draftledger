/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { optimizePackageImports: [] },
  serverExternalPackages: ['pg'],
};
export default nextConfig;
