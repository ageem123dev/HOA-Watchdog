import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      /**
       * Next.js defaults a Server Action request body to 1 MB.
       *
       * That default silently outranks the application's own limit: with it in
       * place, every supported document larger than 1 MB — which is most real
       * scanned statements — is refused by the framework before the upload
       * action runs, and the 25 MiB limit in `core/ingestion/acceptance.ts`
       * describes something that can never happen.
       *
       * This must stay at or above `MAX_UPLOAD_BATCH_BYTES` (50 MiB), plus a
       * margin for multipart overhead. `core/ingestion/upload-limits.test.ts`
       * reads this file and fails if the two disagree — the failure mode of
       * them disagreeing is invisible until a board member uploads a real
       * document.
       */
      bodySizeLimit: '52mb',
    },
  },
}

export default nextConfig
