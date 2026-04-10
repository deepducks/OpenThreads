import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@openthreads/core', '@openthreads/storage-mongodb'],
  // Allow the mongodb package to run in the Node.js runtime (not Edge)
  serverExternalPackages: ['mongodb'],
  // Ant Design 5 requires the emotion/CSS-in-JS layer; keep it in-bundle.
  experimental: {
    optimizePackageImports: ['antd'],
  },
}

export default nextConfig
