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

    // Role passwords: set only when the corresponding URL is not already recorded,
    // so re-running does not rotate credentials out from under a running service.
    for (const role of ROLES) {
      const key = `${role.toUpperCase()}_DATABASE_URL`
      if ((process.env[key] ?? '').trim() !== '') {
        console.log(`skip  ${key} (already set)`)
        continue
      }

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

      setEnvValue(key, roleUrl(adminUrl, role, password))
      console.log(`set   ${key}`)
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
