import { describe, expect, it, vi } from 'vitest'
import {
  MissingSupabaseConfigError,
  SUPABASE_ANON_KEY_VAR,
  SUPABASE_URL_VAR,
  readSupabaseConfig,
} from './env'

const complete = {
  [SUPABASE_URL_VAR]: 'https://project.supabase.co',
  [SUPABASE_ANON_KEY_VAR]: 'anon-key',
}

describe('readSupabaseConfig', () => {
  it('returns the configuration when both variables are present', () => {
    expect(readSupabaseConfig(complete)).toEqual({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
    })
  })

  it('trims surrounding whitespace, which a copied value routinely carries', () => {
    expect(
      readSupabaseConfig({
        [SUPABASE_URL_VAR]: '  https://project.supabase.co  ',
        [SUPABASE_ANON_KEY_VAR]: '\tanon-key\n',
      }),
    ).toEqual({ url: 'https://project.supabase.co', anonKey: 'anon-key' })
  })

  it('throws a named error rather than returning a half-configured client', () => {
    expect(() => readSupabaseConfig({})).toThrow(MissingSupabaseConfigError)
  })

  it('names every missing variable at once, not just the first', () => {
    try {
      readSupabaseConfig({})
      throw new Error('expected readSupabaseConfig to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingSupabaseConfigError)
      expect((error as MissingSupabaseConfigError).missing).toEqual([
        SUPABASE_URL_VAR,
        SUPABASE_ANON_KEY_VAR,
      ])
    }
  })

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('treats a %s url as missing', (_label, url) => {
    expect(() =>
      readSupabaseConfig({ ...complete, [SUPABASE_URL_VAR]: url }),
    ).toThrow(MissingSupabaseConfigError)
  })

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('treats a %s anon key as missing', (_label, key) => {
    expect(() =>
      readSupabaseConfig({ ...complete, [SUPABASE_ANON_KEY_VAR]: key }),
    ).toThrow(MissingSupabaseConfigError)
  })

  it('says what to do next, per the project voice — no apology, no raw provider error', () => {
    const error = new MissingSupabaseConfigError([SUPABASE_URL_VAR])

    expect(error.message).toContain('.env.example')
    expect(error.message).not.toMatch(/sorry|apolog/i)
  })
})

describe('module load safety', () => {
  it('imports without throwing when the environment is empty, so next build does not need credentials', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')

    // The whole point of the lazy read: importing must be inert. If this module
    // ever constructs a client or validates at module scope, this import throws
    // and `npm run build` starts requiring a populated environment.
    await expect(import('./env')).resolves.toBeDefined()

    vi.unstubAllEnvs()
  })
})
