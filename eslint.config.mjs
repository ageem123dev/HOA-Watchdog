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
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
]

export default config
