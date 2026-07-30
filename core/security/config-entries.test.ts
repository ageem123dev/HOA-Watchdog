import { describe, expect, it } from 'vitest'
import {
  entriesFromEnv,
  entriesFromJson,
  entriesFromText,
  secretReferencesFromText,
  type ConfigEntry,
} from './config-entries'

/**
 * The inverse of `entriesFromText`, kept in the test rather than in production
 * so nothing ships that only the suite calls.
 */
const renderEntriesAsText = (entries: readonly ConfigEntry[]): string =>
  entries.map((entry) => `${entry.name}=${entry.value ?? ''}`).join('\n')

describe('entriesFromEnv', () => {
  it('returns one entry per variable, tagged with the given source', () => {
    const entries = entriesFromEnv('process.env', { ALPHA: 'one', BETA: 'two' })

    expect(entries).toEqual([
      { source: 'process.env', name: 'ALPHA', value: 'one' },
      { source: 'process.env', name: 'BETA', value: 'two' },
    ])
  })

  it('keeps a variable whose value is undefined, reporting the name alone', () => {
    const entries = entriesFromEnv('process.env', { DECLARED_BUT_UNSET: undefined })

    expect(entries).toEqual([{ source: 'process.env', name: 'DECLARED_BUT_UNSET' }])
  })

  it('returns no entries for an empty environment', () => {
    expect(entriesFromEnv('process.env', {})).toEqual([])
  })

  it('ignores inherited properties so a polluted prototype cannot inject an entry', () => {
    const polluted = Object.create({ INHERITED_KEY: 'from-prototype' }) as Record<string, string>
    polluted.OWN_KEY = 'own'

    expect(entriesFromEnv('process.env', polluted)).toEqual([
      { source: 'process.env', name: 'OWN_KEY', value: 'own' },
    ])
  })

  it('rejects a non-object environment rather than silently reporting nothing', () => {
    expect(() => entriesFromEnv('process.env', null as never)).toThrow(TypeError)
  })
})

describe('entriesFromText', () => {
  it('parses ordinary KEY=VALUE lines', () => {
    const entries = entriesFromText('.env.example', 'ALPHA=one\nBETA=two\n')

    expect(entries).toEqual([
      { source: '.env.example', name: 'ALPHA', value: 'one' },
      { source: '.env.example', name: 'BETA', value: 'two' },
    ])
  })

  it('parses YAML-style KEY: VALUE lines, ignoring indentation', () => {
    const entries = entriesFromText('ci.yml', '  ALPHA: one\n    BETA: two\n')

    expect(entries).toEqual([
      { source: 'ci.yml', name: 'ALPHA', value: 'one' },
      { source: 'ci.yml', name: 'BETA', value: 'two' },
    ])
  })

  it('strips a leading export so shell-style files parse', () => {
    expect(entriesFromText('.env', 'export ALPHA=one\n')).toEqual([
      { source: '.env', name: 'ALPHA', value: 'one' },
    ])
  })

  it('splits on the first delimiter only, so a value may contain one', () => {
    expect(entriesFromText('.env', 'DATABASE_URL=postgres://u:p@h/db?a=b\n')).toEqual([
      { source: '.env', name: 'DATABASE_URL', value: 'postgres://u:p@h/db?a=b' },
    ])
  })

  it('strips matching surrounding quotes from a value', () => {
    expect(entriesFromText('.env', 'ALPHA="one"\nBETA=\'two\'\n')).toEqual([
      { source: '.env', name: 'ALPHA', value: 'one' },
      { source: '.env', name: 'BETA', value: 'two' },
    ])
  })

  it('keeps an unmatched quote as part of the value rather than truncating it', () => {
    expect(entriesFromText('.env', 'ALPHA="one\n')).toEqual([
      { source: '.env', name: 'ALPHA', value: '"one' },
    ])
  })

  it('does not leak a carriage return into the value on CRLF files', () => {
    expect(entriesFromText('.env', 'ALPHA=one\r\nBETA=two\r\n')).toEqual([
      { source: '.env', name: 'ALPHA', value: 'one' },
      { source: '.env', name: 'BETA', value: 'two' },
    ])
  })

  it('skips comment lines', () => {
    expect(entriesFromText('.env', '# ALPHA=one\n  # BETA=two\nGAMMA=three\n')).toEqual([
      { source: '.env', name: 'GAMMA', value: 'three' },
    ])
  })

  it('skips blank lines and lines with no delimiter', () => {
    expect(entriesFromText('.env', '\n   \njust some prose\nALPHA=one\n')).toEqual([
      { source: '.env', name: 'ALPHA', value: 'one' },
    ])
  })

  it('records an empty value as present-but-empty rather than absent', () => {
    expect(entriesFromText('.env', 'ALPHA=\n')).toEqual([
      { source: '.env', name: 'ALPHA', value: '' },
    ])
  })

  it('skips a line whose name is empty', () => {
    expect(entriesFromText('.env', '=orphaned\n')).toEqual([])
  })

  it('returns no entries for empty content', () => {
    expect(entriesFromText('.env', '')).toEqual([])
  })

  it('rejects non-string content rather than silently reporting nothing', () => {
    expect(() => entriesFromText('.env', undefined as never)).toThrow(TypeError)
  })

  it('round-trips: rendering entries and re-parsing yields the same entries', () => {
    const original: ConfigEntry[] = [
      { source: '.env', name: 'ALPHA', value: 'one' },
      { source: '.env', name: 'DATABASE_URL', value: 'postgres://u:p@h/db?a=b' },
      { source: '.env', name: 'EMPTY', value: '' },
    ]

    expect(entriesFromText('.env', renderEntriesAsText(original))).toEqual(original)
  })
})

describe('entriesFromText — shapes real config files actually use', () => {
  it('parses a YAML sequence item, which is how env vars appear in compose and action files', () => {
    expect(entriesFromText('compose.yml', '    - PLAID_SECRET=abc\n    - ALPHA: one\n')).toEqual([
      { source: 'compose.yml', name: 'PLAID_SECRET', value: 'abc' },
      { source: 'compose.yml', name: 'ALPHA', value: 'one' },
    ])
  })

  it('splits on a lone carriage return, not only on CRLF and LF', () => {
    expect(entriesFromText('.env', 'ALPHA=one\rBETA=two\r')).toEqual([
      { source: '.env', name: 'ALPHA', value: 'one' },
      { source: '.env', name: 'BETA', value: 'two' },
    ])
  })

  it('leaves a value containing interior quotes intact rather than unbalancing it', () => {
    expect(entriesFromText('.env', 'ALPHA="a" and "b"\n')).toEqual([
      { source: '.env', name: 'ALPHA', value: '"a" and "b"' },
    ])
  })
})

describe('entriesFromJson', () => {
  it('reports a key nested inside an object, which is how vercel.json carries env', () => {
    const content = JSON.stringify({ env: { PLAID_SECRET: 'super-secret' } })

    expect(entriesFromJson('vercel.json', content)).toEqual([
      { source: 'vercel.json', name: 'PLAID_SECRET', value: 'super-secret' },
    ])
  })

  it('walks arrays, reporting each string leaf under its nearest key', () => {
    const content = JSON.stringify({ build: { env: [{ PLAID_SECRET: 'a' }, { CLEAN: 'b' }] } })

    expect(entriesFromJson('vercel.json', content)).toEqual([
      { source: 'vercel.json', name: 'PLAID_SECRET', value: 'a' },
      { source: 'vercel.json', name: 'CLEAN', value: 'b' },
    ])
  })

  it('reports a key whose value is not a string, so the name alone is still checked', () => {
    expect(entriesFromJson('vercel.json', JSON.stringify({ PLAID_SECRET: 12345 }))).toEqual([
      { source: 'vercel.json', name: 'PLAID_SECRET', value: '12345' },
    ])
  })

  it('returns no entries for an empty object', () => {
    expect(entriesFromJson('vercel.json', '{}')).toEqual([])
  })

  it('throws on malformed JSON rather than reporting a clean scan of a file it could not read', () => {
    expect(() => entriesFromJson('vercel.json', '{ not json')).toThrow(/vercel\.json/)
  })

  it('rejects non-string content', () => {
    expect(() => entriesFromJson('vercel.json', undefined as never)).toThrow(TypeError)
  })
})

describe('secretReferencesFromText', () => {
  it('reports the referenced secret name, not the variable it was mapped onto', () => {
    const content = '        env:\n          MISC_TOKEN: ${{ secrets.PLAID_SECRET }}\n'

    expect(secretReferencesFromText('ci.yml', content)).toEqual([
      { source: 'ci.yml', name: 'PLAID_SECRET' },
    ])
  })

  it('reports a reference written without surrounding spaces', () => {
    expect(secretReferencesFromText('ci.yml', 'x: ${{secrets.STRIPE_SECRET_KEY}}')).toEqual([
      { source: 'ci.yml', name: 'STRIPE_SECRET_KEY' },
    ])
  })

  it('reports a reference used inline in a run step, where no assignment exists', () => {
    const content = '      - run: deploy --key ${{ secrets.QUICKBOOKS_REFRESH_TOKEN }}\n'

    expect(secretReferencesFromText('ci.yml', content)).toEqual([
      { source: 'ci.yml', name: 'QUICKBOOKS_REFRESH_TOKEN' },
    ])
  })

  it('reports every reference on a line, not just the first', () => {
    const content = 'x: ${{ secrets.PLAID_SECRET }} ${{ secrets.DWOLLA_APP_SECRET }}'

    expect(secretReferencesFromText('ci.yml', content).map((e) => e.name)).toEqual([
      'PLAID_SECRET',
      'DWOLLA_APP_SECRET',
    ])
  })

  it('is stable across repeated calls, so no matcher carries lastIndex between runs', () => {
    const content = 'x: ${{ secrets.PLAID_SECRET }}'

    expect(secretReferencesFromText('ci.yml', content)).toEqual(
      secretReferencesFromText('ci.yml', content),
    )
  })

  it('ignores the github token and other non-secret expressions', () => {
    const content = 'a: ${{ github.ref }}\nb: ${{ env.NODE_ENV }}\n'

    expect(secretReferencesFromText('ci.yml', content)).toEqual([])
  })

  it('returns nothing for content with no references', () => {
    expect(secretReferencesFromText('ci.yml', 'name: CI\n')).toEqual([])
  })

  it('rejects non-string content', () => {
    expect(() => secretReferencesFromText('ci.yml', null as never)).toThrow(TypeError)
  })
})
