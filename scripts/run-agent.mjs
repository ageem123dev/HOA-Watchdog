/**
 * Runs the agent service on the interpreter AD-15 pins.
 *
 * The same argument as `run-pytest.mjs`, one step further along: a service
 * started on the ambient 3.14 is running in an environment CrewAI cannot be
 * installed into, and it would fail at the first model call rather than at
 * startup. So the venv is the interpreter, and its absence is an error with
 * instructions rather than a fallback to whatever `python` means today.
 *
 * The interpreter check itself is `run-pytest.mjs`'s and is not repeated here —
 * that script validates the pin against CrewAI's range and the venv against the
 * pin, and it runs in the gate before every push. Restating it would be a second
 * statement of one rule with nothing failing on disagreement.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AGENT = join(REPO_ROOT, 'agent')

const interpreter = [
  join(AGENT, '.venv', 'Scripts', 'python.exe'),
  join(AGENT, '.venv', 'bin', 'python'),
].find((candidate) => existsSync(candidate))

if (!interpreter) {
  console.error(
    [
      'No virtual environment for the agent service.',
      '',
      'Create it with the pinned interpreter, then re-run:',
      '',
      '  PowerShell:',
      '    py -3.13 -m venv agent/.venv',
      '    agent/.venv/Scripts/python.exe -m pip install -e "agent[dev]"',
      '',
      '  bash:',
      '    python3.13 -m venv agent/.venv',
      '    agent/.venv/bin/python -m pip install -e "agent[dev]"',
    ].join('\n'),
  )
  process.exit(1)
}

// `--factory`, because `create_app` takes its router and narrator as parameters
// so the suite can substitute them. A module-level app instance would have to
// resolve them at import time, which is what makes a service untestable.
const result = spawnSync(
  interpreter,
  [
    '-m',
    'uvicorn',
    'watchdog_agent.chat_service:create_app',
    '--factory',
    '--port',
    process.env.AGENT_PORT ?? '8787',
    ...process.argv.slice(2),
  ],
  { cwd: AGENT, stdio: 'inherit' },
)

if (result.error) {
  console.error(`could not run ${interpreter}: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
