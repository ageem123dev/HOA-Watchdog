import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      // Tracked but not authored here: BMad tooling and its generated artifacts.
      '.agents/**',
      '.claude/**',
      '_bmad/**',
      '_bmad-output/**',
      // Untracked local diagnostic scratch (also in .gitignore). Without this the
      // lint gate reports errors in throwaway probe files, which both masks real
      // findings and makes a passing build look broken.
      '.probe/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
]

export default config
