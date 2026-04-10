import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@openthreads/core', '@openthreads/storage-mongodb'],
  // Allow the mongodb package to run in the Node.js runtime (not Edge)
  serverExternalPackages: ['mongodb'],
}

export default nextConfig
