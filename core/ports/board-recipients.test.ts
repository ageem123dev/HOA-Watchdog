/**
 * Who an alert goes to, as a capability of its own.
 *
 * **A separate port from `UserDirectory`, deliberately.** That one is sign-in:
 * look a member up by the address they typed, and upgrade a hash whose
 * parameters have fallen behind. Adding "list every address on the board" to it
 * would hand the authentication path an enumeration of the whole directory, and
 * `finding.ts` already argues why that is the wrong shape — a capability nothing
 * declares is a capability nothing can quietly acquire.
 *
 * **No `limit`, and that is the one place this project's usual rule is
 * deliberately not applied.** Every other read here is bounded, because every
 * other read is over a table that grows without bound. The board is not: it is a
 * handful of directors, fixed by the association rather than by usage. And the
 * failure a limit would cause is the exact failure this story exists to prevent
 * — a director silently missing from a warning, with nothing anywhere reporting
 * that they were dropped. An unbounded read of a bounded table is the safer of
 * the two mistakes available.
 *
 * The helper is `core/ports/declared-members.ts`, which has its own tests.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { declaredMembers } from './declared-members'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'board-recipients.ts'), 'utf8')
const directorySource = readFileSync(join(HERE, 'user-directory.ts'), 'utf8')

describe('the BoardRecipients port', () => {
  it('declares one read and no way to write', () => {
    expect(declaredMembers(source, 'BoardRecipients')).toEqual([
      'active(): Promise<readonly string[]>',
    ])
  })
})

describe('sign-in does not acquire the ability to enumerate the board', () => {
  it('leaves UserDirectory exactly as it was', () => {
    // The negative half of the split. If the recipient read ever migrates onto
    // `UserDirectory` for convenience, this is what fails.
    expect(declaredMembers(directorySource, 'UserDirectory')).toEqual([
      'findByEmail(email: string): Promise<DirectoryUser | null>',
      'updatePasswordHash(userId: string, passwordHash: string): Promise<void>',
    ])
  })
})
