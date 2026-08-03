import { PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3'

import type { DocumentStore, StoredDocument } from '../../core/ports/document-store'

/**
 * The S3-compatible implementation of the document store (AD-16, R2).
 *
 * This file is the only place in the application that imports the AWS SDK;
 * `core/ports/boundary.test.ts` enforces that. Everything above it deals in
 * `DocumentStore`, which is what keeps the ingestion rules testable with no
 * network and no credentials.
 *
 * **Configuration is read on first use, never at module scope.** Next.js
 * evaluates modules during `next build`, so a module-scope read that throws
 * makes the build itself require real R2 credentials — CI could no longer build
 * the application, and the build gate would only run for a developer with a
 * populated environment. `adapters/auth/env.ts` carries the same note for the
 * same reason; this is that lesson applied rather than relearned.
 */

const REQUIRED_VARS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const

export class MissingStorageConfigError extends Error {
  override readonly name = 'MissingStorageConfigError'

  constructor(readonly missing: readonly string[]) {
    super(
      `Object storage is not configured: ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } missing. Copy .env.example to .env.local and fill in the values.`,
    )
  }
}

interface StorageConfig {
  readonly accountId: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly bucket: string
}

function readConfig(env: Readonly<Record<string, string | undefined>>): StorageConfig {
  // Collect every missing name before throwing. Reporting them one deploy at a
  // time is a slow way to configure four variables.
  const missing = REQUIRED_VARS.filter((name) => !env[name]?.trim())

  if (missing.length > 0) throw new MissingStorageConfigError(missing)

  return {
    accountId: env.R2_ACCOUNT_ID!.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
    bucket: env.R2_BUCKET!.trim(),
  }
}

export interface S3DocumentStoreOptions {
  /** Defaults to `process.env`, read at call time. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** A ready-made client, for tests. Bypasses configuration entirely. */
  readonly client?: S3Client
  /** Seam for asserting how the client is built, without reaching into the SDK. */
  readonly createClient?: (config: S3ClientConfig) => S3Client
}

export function createS3DocumentStore(options: S3DocumentStoreOptions = {}): DocumentStore {
  // Built once on first use and kept: a client per document would open a socket
  // pool per document, and a board uploads in batches.
  let client: S3Client | undefined = options.client
  let bucket: string | undefined

  const connect = (): { client: S3Client; bucket: string } => {
    const config = readConfig(options.env ?? process.env)

    bucket ??= config.bucket
    client ??= (options.createClient ?? ((init) => new S3Client(init)))({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })

    return { client, bucket }
  }

  return {
    async put(document: StoredDocument): Promise<void> {
      const connection = connect()

      // Nothing is caught here on purpose. The SDK's error already says what
      // went wrong; wrapping it would add a message this adapter would have to
      // build out of the configuration it is holding, which is how a secret
      // ends up in a log line.
      await connection.client.send(
        new PutObjectCommand({
          Bucket: connection.bucket,
          Key: document.key,
          Body: document.bytes,
          ContentType: document.contentType,
        }),
      )
    },
  }
}
