/**
 * What the mail port is allowed to be.
 *
 * Types and prose, so what can be checked is the shape of the declarations —
 * and here the shape carries two decisions that would otherwise survive only as
 * habits:
 *
 * - **The message is plain text, and the type is what says so.** AD-8 binds
 *   FR-8: extracted values are data, never instructions. A vendor name lifted
 *   off a scanned invoice goes into this message, and the cheapest way to keep
 *   it data is to send a document with no markup for it to become. An `html`
 *   field added here later would re-open that decision silently, in a diff that
 *   looks like an enhancement — so the exact member list is the guard.
 * - **`to` is a list.** A `string` would let a caller send to one director and
 *   believe it had told the board. The recipient rule is every board member who
 *   is not disabled, and a type that can hold exactly one of them is a type that
 *   invites the bug.
 *
 * The mailer is write-only for the reason `finding.ts` gives for splitting
 * raising from reviewing: a capability nothing declares is a capability nothing
 * can quietly acquire. A `MailSender` that could also *read* would be a mailbox
 * the gateway polls, which is a different product with a different threat model.
 *
 * The helper is `core/ports/declared-members.ts`, which has its own tests.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { declaredMembers } from './declared-members'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'mail.ts'), 'utf8')

describe('the MailSender port', () => {
  it('declares exactly one capability, and it writes', () => {
    expect(declaredMembers(source, 'MailSender')).toEqual(['send(message: MailMessage): Promise<void>'])
  })
})

describe('the message a board member receives', () => {
  it('carries a list of recipients, a subject and text — and nothing else', () => {
    // The absence of `html` is the assertion. Adding one is a decision about
    // AD-8 and about whether two templates may disagree, and this is where that
    // decision has to be made rather than discovered.
    expect(declaredMembers(source, 'MailMessage')).toEqual([
      'readonly to: readonly string[]',
      'readonly subject: string',
      'readonly text: string',
    ])
  })
})
