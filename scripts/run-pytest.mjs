/**
 * Runs the agent service's pytest suite, on the interpreter it is pinned to.
 *
 * This exists because `pytest` is not a thing you can just invoke here. The
 * ambient interpreter on the development machine is **3.14.6**, and CrewAI's
 * `requires_python` is `<3.14,>=3.10` — so `python3 -m pytest` runs the suite on
 * a version the service is not allowed to use, and would report green from an
 * environment story 3.4 cannot install into. AD-15 pins 3.13 for that reason.
 *
 * So the venv is the interpreter, and its absence is an error with instructions
 * rather than a fallback to whatever `python` happens to mean today. A gate that
 * quietly runs on the wrong runtime is worse than one that refuses.
 *
 * Both venv layouts are handled: `Scripts/python.exe` on Windows,
 * `bin/python` everywhere else. The development machine is Windows and the
 * deploy target is Linux, so hard-coding either one produces a gate that works
 * in exactly one of the two places it needs to.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AGENT = join(REPO_ROOT, 'agent')

const CANDIDATES = [
  join(AGENT, '.venv', 'Scripts', 'python.exe'),
  join(AGENT, '.venv', 'bin', 'python'),
]

const interpreter = CANDIDATES.find((candidate) => existsSync(candidate))

if (!interpreter) {
  console.error(
    [
      'No virtual environment for the agent service.',
      '',
      'Create it with the pinned interpreter — not `python3`, which is 3.14 here',
      'and outside the range AD-15 pins (CrewAI requires <3.14,>=3.10):',
      '',
      '    py -3.13 -m venv agent/.venv          # Windows',
      '    python3.13 -m venv agent/.venv        # Linux/macOS',
      '    agent/.venv/Scripts/python.exe -m pip install pytest    # Windows',
      '    agent/.venv/bin/python -m pip install pytest            # Linux/macOS',
      '',
      'Then re-run `npm run test:py`.',
    ].join('\n'),
  )
  process.exit(1)
}

// `agent` as the working directory so pyproject.toml's `testpaths` and
// `pythonpath` apply — running from the repo root finds neither.
const result = spawnSync(interpreter, ['-m', 'pytest'], {
  cwd: AGENT,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`could not run ${interpreter}: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
