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
    /**
     * Raised from vitest's 5s default, because that default was failing runs on
     * green code.
     *
     * Half a dozen structural guards each walk the whole source tree
     * synchronously — `dual-llm-boundary`, `nfr2-guard`, `no-model-in-alerts`,
     * `sole-chat-path`, `no-association-creation`, the `docs/` scanners. Alone
     * each takes a few hundred milliseconds; run in parallel workers all doing
     * synchronous I/O they contend, and on story 5.1b roughly one run in four
     * failed with a 5s timeout in one scanner or another — a different one each
     * time, always on code that was correct.
     *
     * **This weakens no assertion.** Not one of those tests claims anything about
     * how long it takes; the limit is incidental to what they check, and the
     * project's own test-design reference argues against wall-clock strictness
     * for exactly this reason. A genuinely hung test still fails, fifteen seconds
     * later.
     *
     * The alternative — a suite that fails one run in four — is worse than slow:
     * it teaches everyone to re-run a red gate instead of reading it, and this
     * project has no CI, so the local gate is the only evidence a head is green.
     */
    testTimeout: 15_000,
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
