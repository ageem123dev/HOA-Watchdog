import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
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
