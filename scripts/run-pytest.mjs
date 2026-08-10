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
import { existsSync, readFileSync } from 'node:fs'
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
      '    agent/.venv/Scripts/python.exe -m pip install -e "agent[dev]"   # Windows',
      '    agent/.venv/bin/python -m pip install -e "agent[dev]"           # Linux/macOS',
      '',
      'Then re-run `npm run test:py`.',
    ].join('\n'),
  )
  process.exit(1)
}

// **The version is checked here, not left to a test.**
//
// This picked the first venv that existed and ran it. A venv built with
// `python3 -m venv` is 3.14 and would have run the suite happily — with only
// `test_interpreter.py` to object. And forwarding arguments (added a round
// earlier, for good reasons) means `npm run test:py -- -k token` deselects that
// test, so the gate could be made to report green from the exact interpreter
// AD-15 forbids. A launcher that can be argued out of its own check is not a
// gate. Raised by CodeRabbit on MR !39.
const pinned = readFileSync(join(AGENT, '.python-version'), 'utf8').trim()
const probe = spawnSync(interpreter, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], {
  encoding: 'utf8',
})
const actual = (probe.stdout ?? '').trim()

if (probe.status !== 0 || actual === '') {
  console.error(`could not determine the version of ${interpreter}: ${probe.stderr ?? ''}`)
  process.exit(1)
}

if (actual !== pinned) {
  console.error(
    [
      `The agent venv is Python ${actual}; agent/.python-version pins ${pinned}.`,
      '',
      "CrewAI's requires_python is <3.14,>=3.10 (AD-15), and the ambient interpreter",
      'here is 3.14 — so a venv built with `python3 -m venv` runs the suite on a',
      'version the service is not allowed to use. Rebuild it:',
      '',
      '    rm -rf agent/.venv',
      `    py -3.${pinned.split('.')[1]} -m venv agent/.venv        # Windows`,
      `    python${pinned} -m venv agent/.venv                      # Linux/macOS`,
      '    agent/.venv/Scripts/python.exe -m pip install -e "agent[dev]"   # Windows',
      '    agent/.venv/bin/python -m pip install -e "agent[dev]"           # Linux/macOS',
    ].join('\n'),
  )
  process.exit(1)
}

// `agent` as the working directory so pyproject.toml's `testpaths` and
// `pythonpath` apply — running from the repo root finds neither.
//
// Extra arguments are forwarded, so `npm run test:py -- -k token` and
// `-- -x --ff` work. Without it the wrapper is strictly worse than the command
// it replaces, and the first person who needs one test will go around it. Safe
// now that the version is enforced above rather than by a deselectable test.
const result = spawnSync(interpreter, ['-m', 'pytest', ...process.argv.slice(2)], {
  cwd: AGENT,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`could not run ${interpreter}: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
