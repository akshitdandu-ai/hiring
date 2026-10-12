import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      allowedOrigins: ['*'],
    },
  },
  images: {
    unoptimized: true,
  },
}

export default config
