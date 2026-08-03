/**
 * The S3 adapter's own translation, tested without a network or a credential.
 *
 * What is under test is not the AWS SDK — it is whether this adapter reads its
 * configuration at the right moment, names what is missing, and hands the SDK
 * the fields it meant to. Those are the adapter's bugs.
 *
 * The build-time trap is the one with history. `adapters/auth/env.ts` carries a
 * comment explaining it: Next.js evaluates modules during `next build`, so
 * configuration read at module scope makes the build itself require real
 * credentials, and CI can no longer build the application. That failure is one
 * line away from this file.
 */

import { PutObjectCommand } from '@aws-sdk/client-s3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MissingStorageConfigError, createS3DocumentStore } from './document-store-s3'

const CONFIGURED = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key-id',
  R2_SECRET_ACCESS_KEY: 'secret-value-that-must-never-be-echoed',
  R2_BUCKET: 'watchdog-documents',
}

interface RecordedClient {
  send: ReturnType<typeof vi.fn>
  commands: unknown[]
}

function fakeClient(behaviour?: () => Promise<unknown>): RecordedClient {
  const commands: unknown[] = []
  const send = vi.fn(async (command: unknown) => {
    commands.push(command)
    return behaviour ? await behaviour() : {}
  })

  return { send, commands }
}

const document = {
  key: 'documents/abc',
  bytes: new Uint8Array([1, 2, 3]),
  contentType: 'application/pdf',
}

describe('createS3DocumentStore', () => {
  let client: RecordedClient

  beforeEach(() => {
    client = fakeClient()
  })

  describe('when it reads its configuration', () => {
    it('constructs with an empty environment without throwing', () => {
      // If this throws, `next build` needs real R2 credentials and CI cannot
      // build the application at all.
      expect(() => createS3DocumentStore({ env: {} })).not.toThrow()
    })

    it('can be constructed repeatedly with an empty environment', () => {
      expect(() => {
        createS3DocumentStore({ env: {} })
        createS3DocumentStore({ env: {} })
      }).not.toThrow()
    })

    it('throws only when it is actually asked to store something', async () => {
      const store = createS3DocumentStore({ env: {} })

      await expect(store.put(document)).rejects.toBeInstanceOf(MissingStorageConfigError)
    })

    it('names every missing variable, not just the first one it noticed', async () => {
      const store = createS3DocumentStore({ env: { R2_ACCOUNT_ID: 'acct' } })

      await expect(store.put(document)).rejects.toMatchObject({
        missing: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
      })
    })

    it.each([
      ['an empty value', ''],
      ['whitespace only', '   '],
    ])('treats %s as missing rather than as configuration', async (_label, value) => {
      const store = createS3DocumentStore({ env: { ...CONFIGURED, R2_BUCKET: value } })

      await expect(store.put(document)).rejects.toMatchObject({ missing: ['R2_BUCKET'] })
    })

    it('says what to do about it, since this error is read by whoever deploys', async () => {
      const store = createS3DocumentStore({ env: {} })

      await expect(store.put(document)).rejects.toThrow(/\.env\.example/)
    })
  })

  describe('what it hands the SDK', () => {
    it('sends a put carrying the bucket, key, bytes and content type', async () => {
      // Cross-check on the exact fields. A transposed bucket and key still
      // "works" against a mock that only counts calls.
      const store = createS3DocumentStore({ env: CONFIGURED, client: client as never })

      await store.put(document)

      expect(client.send).toHaveBeenCalledTimes(1)
      expect(client.commands[0]).toBeInstanceOf(PutObjectCommand)
      expect((client.commands[0] as PutObjectCommand).input).toEqual({
        Bucket: 'watchdog-documents',
        Key: 'documents/abc',
        Body: document.bytes,
        ContentType: 'application/pdf',
      })
    })

    it('passes the bytes through unchanged', async () => {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
      const store = createS3DocumentStore({ env: CONFIGURED, client: client as never })

      await store.put({ ...document, bytes })

      expect((client.commands[0] as PutObjectCommand).input.Body).toBe(bytes)
    })

    it('reuses one client across calls rather than building a socket pool per document', async () => {
      const constructed: unknown[] = []
      const store = createS3DocumentStore({
        env: CONFIGURED,
        createClient: (config) => {
          constructed.push(config)
          return client as never
        },
      })

      await store.put(document)
      await store.put({ ...document, key: 'documents/def' })

      expect(constructed).toHaveLength(1)
      expect(client.send).toHaveBeenCalledTimes(2)
    })

    it('points at the account endpoint, in the region R2 requires', async () => {
      const constructed: Array<{ region?: string; endpoint?: string }> = []
      const store = createS3DocumentStore({
        env: CONFIGURED,
        createClient: (config) => {
          constructed.push(config as { region?: string; endpoint?: string })
          return client as never
        },
      })

      await store.put(document)

      expect(constructed[0]?.region).toBe('auto')
      expect(constructed[0]?.endpoint).toBe('https://acct.r2.cloudflarestorage.com')
    })
  })

  describe('when the SDK fails', () => {
    it('lets the error through unchanged rather than wrapping it', async () => {
      const failure = Object.assign(new Error('Access Denied'), { name: 'AccessDenied' })
      const failing = fakeClient(async () => {
        throw failure
      })
      const store = createS3DocumentStore({ env: CONFIGURED, client: failing as never })

      await expect(store.put(document)).rejects.toBe(failure)
    })

    it('does not put the secret key into anything it throws', async () => {
      const failing = fakeClient(async () => {
        throw new Error('Access Denied')
      })
      const store = createS3DocumentStore({ env: CONFIGURED, client: failing as never })

      const error = await store.put(document).catch((caught: unknown) => caught)

      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(
        CONFIGURED.R2_SECRET_ACCESS_KEY,
      )
    })
  })
})
