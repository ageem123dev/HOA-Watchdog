import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { randomBytes } from 'node:crypto'

const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
const missing = required.filter((name) => !(process.env[name] ?? '').trim())
if (missing.length > 0) {
  console.error('missing:', missing.join(', '))
  process.exit(1)
}

const bucket = process.env.R2_BUCKET
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
})

const key = `_connectivity-probe/${randomBytes(8).toString('hex')}.txt`
const body = 'watchdog connectivity probe'
let failed = false

const step = async (label, fn) => {
  try {
    const detail = await fn()
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`)
    return true
  } catch (error) {
    console.log(`  FAIL  ${label} — ${error.name}: ${error.message}`)
    failed = true
    return false
  }
}

console.log(`\nbucket: ${bucket}`)
console.log(`endpoint: https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com\n`)

await step('reach the bucket', async () => {
  await client.send(new HeadBucketCommand({ Bucket: bucket }))
  return 'exists and is readable'
})

await step('put an object', async () => {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }),
  )
  return key
})

await step('get it back byte-identical', async () => {
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const text = await result.Body.transformToString()
  if (text !== body) throw new Error(`round trip mismatch: ${JSON.stringify(text)}`)
  return `${text.length} bytes match`
})

await step('delete it', async () => {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  return 'cleaned up'
})

await step('confirm it is gone', async () => {
  try {
    await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  } catch (error) {
    if (error.name === 'NoSuchKey') return 'NoSuchKey as expected'
    throw error
  }
  throw new Error('object still present after delete')
})

/**
 * Whether the token is scoped to this bucket alone.
 *
 * The obvious version of this check asks for `${bucket}-not-ours` and treats any
 * error as proof. It proves nothing: that bucket almost certainly does not exist,
 * so the request 404s for every token including an account-wide one. It confirms a
 * name is unused, then reports the token is scoped.
 *
 * A real check needs a bucket that *exists* and sits outside the token's scope,
 * and needs to distinguish the two refusals. Access denied means the bucket is
 * there and the token cannot reach it — scoping proven. Not found means the token
 * cannot see it either way, which tells us nothing.
 *
 * That target cannot be guessed, so it is named explicitly. Without it the check
 * reports SKIP. A check that cannot run must not print PASS.
 */
const outOfScopeBucket = (process.env.R2_OUT_OF_SCOPE_BUCKET ?? '').trim()

if (outOfScopeBucket === '') {
  console.log(
    '  SKIP  token is scoped — set R2_OUT_OF_SCOPE_BUCKET to a bucket that exists in this\n' +
      '        account but outside the token scope. Unset, this cannot be distinguished from\n' +
      '        a bucket that simply does not exist, so it is not asserted.',
  )
} else if (outOfScopeBucket === bucket) {
  console.log(`  FAIL  token is scoped — R2_OUT_OF_SCOPE_BUCKET names the bucket under test`)
  failed = true
} else {
  await step(`token is scoped — ${outOfScopeBucket} is refused`, async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: outOfScopeBucket }))
    } catch (error) {
      const status = error.$metadata?.httpStatusCode
      if (status === 403 || error.name === 'AccessDenied' || error.name === 'Forbidden') {
        return `refused with ${error.name} (${status ?? 'no status'})`
      }
      if (status === 404 || error.name === 'NotFound' || error.name === 'NoSuchBucket') {
        throw new Error(
          `${outOfScopeBucket} was not found, so this proves nothing about scoping — ` +
            'name a bucket that exists in the account',
        )
      }
      throw error
    }
    throw new Error(`token reached ${outOfScopeBucket}, which is outside the scope it should have`)
  })
}

console.log(failed ? '\nSOME CHECKS FAILED\n' : '\nR2 is ready.\n')
process.exit(failed ? 1 : 0)
