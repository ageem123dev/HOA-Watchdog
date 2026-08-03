/**
 * Starts the built application and requests real routes.
 *
 * This exists because the unit suite cannot catch a whole class of failure. The
 * Auth.js migration shipped with `NextAuth(config => …)`, whose `auth` export is
 * async — so `auth(handler)` in `proxy.ts` was a Promise, not a function, and
 * Next.js served **HTTP 500 on every route including sign-in**. Lint, tsc, build
 * and 390 tests were all green, because `proxy.test.ts` mocks the very module
 * that was broken.
 *
 * No amount of mocking would have caught it. Only starting the server and asking
 * it for a page does. Run with:
 *
 *   npm run build && npm run smoke
 */

import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const PORT = Number(process.env.SMOKE_PORT ?? 4321)
const BASE = `http://127.0.0.1:${PORT}`
const STARTUP_TIMEOUT_MS = 60_000

/**
 * Every check states the status it expects. A route that 500s is the failure
 * this file exists for, but so is a protected route that quietly returns 200.
 */
const CHECKS = [
  { path: '/sign-in', expect: 200, why: 'the only public surface must render' },
  { path: '/dashboard', expect: 307, why: 'protected: unauthenticated visitors are redirected' },
  { path: '/', expect: 307, why: 'the root redirects into the guarded area' },
  { path: '/api/auth/csrf', expect: 200, why: 'Auth.js endpoints must answer, or nobody can sign in' },
  { path: '/api/auth/session', expect: 200, why: 'session lookup must not error for an anonymous visitor' },
]

const server = spawn(
  process.execPath,
  ['--env-file-if-exists=.env.local', './node_modules/next/dist/bin/next', 'start', '-p', String(PORT)],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

let serverOutput = ''
server.stdout.on('data', (chunk) => (serverOutput += chunk))
server.stderr.on('data', (chunk) => (serverOutput += chunk))

const stop = () => {
  try {
    server.kill()
  } catch {
    // already gone
  }
}

process.on('exit', stop)

async function waitForReady() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/sign-in`, { redirect: 'manual' })
      return
    } catch {
      await sleep(400)
    }
  }
  throw new Error(`server did not start within ${STARTUP_TIMEOUT_MS}ms\n${serverOutput}`)
}

let failures = 0

try {
  await waitForReady()

  for (const { path, expect, why } of CHECKS) {
    const response = await fetch(`${BASE}${path}`, { redirect: 'manual' })
    const ok = response.status === expect
    if (!ok) failures += 1
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${path} -> ${response.status} (expected ${expect}) — ${why}`,
    )
  }

  // The redirect target matters as much as the status: a protected route that
  // redirects somewhere other than sign-in is still a broken gate.
  const dashboard = await fetch(`${BASE}/dashboard`, { redirect: 'manual' })
  const location = dashboard.headers.get('location') ?? ''
  const redirectsToSignIn = location.includes('/sign-in')
  if (!redirectsToSignIn) failures += 1
  console.log(
    `  ${redirectsToSignIn ? 'PASS' : 'FAIL'}  /dashboard redirects to sign-in — got ${location || '(none)'}`,
  )

  // An error logged during startup is a failure even when every status is right;
  // UntrustedHost, for instance, returns a status but breaks sign-in entirely.
  const logged = serverOutput.match(/\[auth\]\[error\][^\n]*/g) ?? []
  if (logged.length > 0) {
    failures += 1
    console.log(`  FAIL  server logged auth errors:\n        ${logged.slice(0, 3).join('\n        ')}`)
  } else {
    console.log('  PASS  no auth errors logged during startup')
  }
} catch (error) {
  console.error(`  FAIL  ${error.message}`)
  failures += 1
} finally {
  stop()
}

console.log(failures === 0 ? '\nsmoke: OK\n' : `\nsmoke: ${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
