import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@openthreads/core', '@openthreads/storage-mongodb'],
}

export default nextConfig
