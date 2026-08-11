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
      // The agent service's virtualenv (gitignored). ESLint does not read
      // .gitignore, so installing CrewAI in story 3.4 put six warnings from
      // `crewai/flow/visualization/assets/interactive.js` into the lint gate —
      // third-party JavaScript nobody here authored or can fix. A gate whose
      // output is mostly other people's code is one people stop reading.
      'agent/.venv/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
]

export default config
