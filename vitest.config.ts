import { defineConfig } from 'vitest/config'

export default defineConfig({
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
