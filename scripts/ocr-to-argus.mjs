#!/usr/bin/env node
// Convert an `ocr` review into the event stream `argus_ingest` parses.
//
// Argus learns from this file: anything in it that Argus did not find is written
// to memory as a miss. A false positive is therefore not noise -- it is a lesson
// teaching Argus to reproduce it. So findings are never carried over wholesale;
// `--confirmed` is required, and names the ones a human verified against the
// real file.
//
//   node scripts/ocr-to-argus.mjs --in .argus/ocr.json --list
//   node scripts/ocr-to-argus.mjs --in .argus/ocr.json --commit <sha> \
//     --confirmed 4,9 --reviewed-from main...HEAD --out .argus/ocr-review.jsonl
//
// `--confirmed none` is legitimate and meaningful: a review that ran and
// confirmed nothing is not the same as a review that never ran.

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// ocr's severities, in CodeRabbit's vocabulary -- which is what the adapter
// reads. `argus_ingest` keeps critical+major by default, so a `medium` is
// ingested only when its `severities` option is widened.
const SEVERITY = { critical: 'critical', high: 'major', medium: 'minor', low: 'trivial' }

const args = process.argv.slice(2)
const flag = (name, fallback = undefined) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const has = (name) => args.includes(`--${name}`)

const inPath = flag('in')
if (!inPath) {
  console.error('usage: --in <ocr.json> [--list] [--commit <sha>] [--confirmed 1,4|none]')
  console.error('       [--reviewed <a,b> | --reviewed-from <range>] [--out <file>]')
  process.exit(2)
}

// ocr writes progress before the JSON when stderr and stdout share a file, and
// colour codes survive `--audience agent`. Strip both, then take the object.
const raw = readFileSync(inPath, 'utf8').replace(/\u001b\[[0-9;]*m/g, '')
const start = raw.indexOf('{')
if (start === -1) throw new Error(`no JSON object in ${inPath}`)
const report = JSON.parse(raw.slice(start))
const comments = report.comments ?? []

// A run that dropped files still exits 0 and still reports a finding count, so
// refuse to convert one rather than quietly teaching Argus from a partial review.
const failed = report.retry_report?.failed_requests ?? 0
if (failed > 0) {
  console.error(`refusing: ${failed} request(s) failed, so this review is incomplete.`)
  console.error('Fix the cause and re-run the review; do not ingest a partial.')
  process.exit(1)
}

if (has('list') || !has('confirmed')) {
  comments.forEach((c, i) => {
    const where = `${c.path}:${c.start_line ?? '?'}`
    const first = String(c.content ?? '').split('\n')[0].slice(0, 96)
    console.log(`${String(i + 1).padStart(3)}  [${(c.severity ?? '?').padEnd(8)}] ${where}`)
    console.log(`     ${first}`)
  })
  if (!has('confirmed')) {
    console.error('\n--confirmed is required (or `--confirmed none`). Verify each finding')
    console.error('against the real file first; only confirmed ones may be ingested.')
    process.exit(2)
  }
  process.exit(0)
}

const confirmedArg = String(flag('confirmed'))
const picked =
  confirmedArg === 'none'
    ? []
    : confirmedArg.split(',').map((n) => {
        const i = Number(n.trim())
        if (!Number.isInteger(i) || i < 1 || i > comments.length) {
          throw new Error(`--confirmed ${n.trim()} is not a finding index (1..${comments.length})`)
        }
        return comments[i - 1]
      })

// reviewedFiles carries what was reviewed *and clean*, which a finding list
// cannot express. Deriving it from the findings would tell Argus that every
// clean file went unreviewed.
let reviewed
if (flag('reviewed')) {
  reviewed = flag('reviewed').split(',').map((s) => s.trim()).filter(Boolean)
} else if (flag('reviewed-from')) {
  reviewed = execFileSync('git', ['diff', '--name-only', flag('reviewed-from')], {
    encoding: 'utf8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
} else {
  reviewed = [...new Set(comments.map((c) => c.path).filter(Boolean))]
  console.error('warning: no --reviewed/--reviewed-from given, so reviewedFiles lists only')
  console.error('files that produced findings. Files reviewed and clean will look unreviewed.')
}

const events = []
events.push({
  type: 'review_context',
  reviewType: 'ocr',
  ...(flag('commit') ? { headCommitId: flag('commit') } : {}),
})

let skipped = 0
for (const c of picked) {
  const severity = SEVERITY[String(c.severity ?? '').toLowerCase()]
  if (!severity) {
    console.error(`warning: unmapped severity ${JSON.stringify(c.severity)} on ${c.path}, skipped`)
    skipped += 1
    continue
  }
  const body = String(c.content ?? '').trim()
  if (!body) {
    console.error(`warning: empty body on ${c.path}, skipped (the adapter drops title-less findings)`)
    skipped += 1
    continue
  }
  events.push({
    type: 'finding',
    severity,
    fileName: c.path,
    ...(Number.isInteger(c.start_line) ? { line: c.start_line } : {}),
    ...(c.category ? { category: c.category } : {}),
    comment: body,
  })
}

events.push({ type: 'complete', status: 'review_completed', reviewedFiles: reviewed })

const out = flag('out')
const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
if (out) writeFileSync(out, text)
else process.stdout.write(text)

const kept = events.filter((e) => e.type === 'finding').length
console.error(
  `wrote ${kept} finding(s) of ${comments.length} reviewed` +
    `${skipped ? `, ${skipped} skipped` : ''}; reviewedFiles=${reviewed.length}` +
    `${out ? ` -> ${out}` : ''}`,
)
