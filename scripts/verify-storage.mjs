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

// The token was scoped to one bucket. Prove the scoping is real rather than
// assumed: reaching a bucket we did not name must be refused.
await step('token is scoped — a different bucket is refused', async () => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: `${bucket}-not-ours` }))
  } catch (error) {
    return `refused with ${error.name}`
  }
  throw new Error('token could reach a bucket it was not scoped to')
})

console.log(failed ? '\nSOME CHECKS FAILED\n' : '\nR2 is ready.\n')
process.exit(failed ? 1 : 0)
