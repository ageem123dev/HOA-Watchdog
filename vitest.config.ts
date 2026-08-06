import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  // `@/` is how everything under `app/` imports, and tsconfig maps it. Vitest
  // did not, which failed quietly in a specific way: a *type* import through the
  // alias is erased before runtime, so the one existing app test resolved fine
  // and the alias looked configured. The first value import through it — a
  // component test — could not load the file at all.
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // `.tsx` as well as `.ts`. Story 1.6c added the first component tests, and
    // with the narrower glob they were collected by nothing: the file passed by
    // never running, which reads exactly like a file that ran and was fine.
    include: ['**/*.test.{ts,tsx}'],
    // '.probe/**' is untracked local diagnostic scratch (see .gitignore). Without it,
    // a throwaway probe test is collected into the real suite and can fail the build
    // for reasons that have nothing to do with the product.
    exclude: [
      'node_modules/**',
      '.next/**',
      '.agents/**',
      '_bmad/**',
      '_bmad-output/**',
      '.probe/**',
    ],
  },
})
