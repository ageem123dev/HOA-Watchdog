/**
 * Applies migrations/*.sql in filename order, once each, inside a transaction.
 *
 * Run with: node --env-file=.env.local scripts/migrate.mjs
 *
 * Role passwords are set here from generated values rather than written into a
 * migration, so no credential is ever committed. Re-running is safe: applied
 * migrations are skipped, and the role passwords are only generated on the first
 * run that creates them.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

import { probeEnvFile, recordingTarget } from './password-recorder.ts'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'migrations')
const ENV_FILE = join(REPO_ROOT, '.env.local')

const ROLES = ['watchdog_writer', 'watchdog_reader']

function generatePassword() {
  // base64url so the value is safe to embed in a connection string without
  // percent-encoding, which is a reliable source of "works locally, fails in CI".
  return randomBytes(24).toString('base64url')
}

/**
 * Rewrites a single KEY=value line in .env.local, leaving everything else alone.
 *
 * The replacement is a function, not a string. `String.prototype.replace` reads
 * `$&`, `` $` ``, `$'`, `$1` and `$$` inside a replacement *string* as
 * substitution patterns, and `value` here is a connection URL carrying the host,
 * port, path and admin credentials copied out of DATABASE_URL. A single `$` in
 * any of those silently writes a corrupted URL, and the damage surfaces much
 * later as an authentication failure with nothing pointing back to this line.
 */
function setEnvValue(key, value) {
  const source = readFileSync(ENV_FILE, 'utf8')
  const line = `${key}=${value}`
  const existing = new RegExp(`^${key}=.*$`, 'm')

  const updated = existing.test(source)
    ? source.replace(existing, () => line)
    : `${source.trimEnd()}\n${line}\n`

  writeFileSync(ENV_FILE, updated, 'utf8')
}

function roleUrl(adminUrl, role, password) {
  const url = new URL(adminUrl)
  url.username = role
  url.password = password
  return url.toString()
}

async function main() {
  const adminUrl = process.env.DATABASE_URL
  if (!adminUrl) throw new Error('DATABASE_URL is not set; run with --env-file=.env.local')

  const client = new pg.Client({ connectionString: adminUrl })
  await client.connect()

  try {
    await client.query(`
      create table if not exists schema_migration (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `)

    const { rows } = await client.query('select filename from schema_migration')
    const applied = new Set(rows.map((row) => row.filename))

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort()

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`skip  ${filename} (already applied)`)
        continue
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')

      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into schema_migration (filename) values ($1)', [filename])
        await client.query('commit')
        console.log(`apply ${filename}`)
      } catch (error) {
        await client.query('rollback')
        throw new Error(`${filename} failed: ${error.message}`, { cause: error })
      }
    }

    /**
     * Role passwords live in the database; the URLs that carry them live in
     * .env.local. Nothing keeps the two in step, and skipping on the file alone
     * gets both directions wrong. A fresh database with a stale .env.local skips
     * every role and leaves them with no password at all, and the failure surfaces
     * later as an authentication error against a URL that looks fine.
     *
     * So the recorded URL is *tried* rather than trusted. If it connects, the
     * password behind it is real and rotating would be the destructive move. If it
     * does not, the record is stale whatever the file says.
     */
    const recordedUrlWorks = async (url) => {
      const probe = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 })
      try {
        await probe.connect()
        await probe.query('select 1')
        return true
      } catch {
        return false
      } finally {
        try {
          await probe.end()
        } catch {
          // Already failed to connect; nothing to close.
        }
      }
    }

    /**
     * The other half of the same problem: ALTER ROLE succeeds, the record of the
     * password is lost, and it exists nowhere but in the database.
     *
     * **Resolved lazily, and only on the run that is about to write one.** It
     * used to be checked unconditionally before this loop, which failed a run
     * whose every role was going to be skipped — nothing was going to be
     * recorded, so there was nothing to refuse. It also cost nothing on a
     * workstation and everything in a container, where the answer is `stdout`
     * rather than an error.
     *
     * Still before the first ALTER ROLE, which is the half that matters: a
     * failure has to land while it is still harmless.
     */
    let recording = null
    const resolveRecording = () => (recording ??= recordingTarget(probeEnvFile(ENV_FILE), ENV_FILE))

    /** Whether anything was printed rather than filed, so the closing warning is earned. */
    let printed = false

    for (const role of ROLES) {
      const key = `${role.toUpperCase()}_DATABASE_URL`
      const recorded = (process.env[key] ?? '').trim()

      if (recorded !== '' && (await recordedUrlWorks(recorded))) {
        console.log(`skip  ${key} (recorded URL connects)`)
        continue
      }

      if (recorded !== '') {
        console.log(`reset ${key} (recorded URL does not connect)`)
      }

      // Before the password exists, let alone before it is set: this throws when
      // `.env.local` is present and unwritable, and that has to happen while the
      // role is still untouched.
      const target = resolveRecording()

      const password = generatePassword()

      // ALTER ROLE takes no bound parameters, so the value is interpolated. That
      // is safe here and only here: the password is generated two lines above
      // from base64url, whose alphabet cannot contain a quote. The assertion
      // makes that a checked precondition rather than a comment someone trusts.
      if (!/^[A-Za-z0-9_-]+$/.test(password)) {
        throw new Error('generated password is not quote-free; refusing to interpolate it')
      }
      if (!ROLES.includes(role)) {
        throw new Error(`refusing to alter an unrecognised role: ${role}`)
      }

      await client.query(`alter role "${role}" password '${password}'`)

      const url = roleUrl(adminUrl, role, password)

      if (target === 'file') {
        setEnvValue(key, url)
        console.log(`set   ${key}`)
      } else {
        // Printed the moment it is set, not collected for a summary at the end.
        // A run that dies between the two roles must still have shown the first
        // one — a summary is the version of this that loses a live credential.
        //
        // The URL is on its own line and nothing else is, so it survives being
        // copied out of a console by eye.
        printed = true
        console.log(`set   ${key} (no .env.local here — record this before you close the shell)`)
        console.log('')
        console.log(`${key}=${url}`)
        console.log('')
      }
    }

    if (printed) {
      // Said once, at the end, where it is read. The values above are the only
      // record there is, and a console is not a secret store: a shell whose
      // scrollback is retained has retained a database credential, which is a
      // rotation rather than a disaster — `migrate` resets a role whose recorded
      // URL no longer connects.
      console.log('The URLs above exist nowhere else. Put them in the service variables now.')
      console.log('If this console keeps scrollback, treat them as exposed and re-run to rotate.')
    }

    console.log('\nmigrations complete')
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
