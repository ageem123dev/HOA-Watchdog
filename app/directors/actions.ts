'use server'

import { randomBytes } from 'node:crypto'

import { auth } from '@/adapters/auth/auth'
import { createDirectorRoster } from '@/adapters/db/director-roster-postgres'
import { hashPassword } from '@/core/auth/password'
import type { DirectorState } from './director-state'

export async function addDirector(
  _previous: DirectorState,
  formData: FormData,
): Promise<DirectorState> {
  const session = await auth()
  const invitedBy = session?.user?.id

  if (typeof invitedBy !== 'string' || invitedBy.trim() === '') {
    return { status: 'error', error: 'Your session has expired. Sign in again to continue.' }
  }

  const email = String(formData.get('email') ?? '').trim()

  /**
   * Shape, not just presence. A server action is its own entry point, so the
   * field's `type="email"` guards nothing here - and `email` is unique across
   * `board_member` while the product refuses duplicates rather than resetting
   * them, so a row created against a malformed address occupies it for good.
   *
   * Deliberately minimal: one `@`, a dot in the domain, no whitespace. Anything
   * stricter starts rejecting real addresses, which is the more expensive
   * failure - this refuses a typo, it does not prove the address receives mail.
   */
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 'error', error: 'Enter the email address the new director will sign in with.' }
  }

  const displayName = String(formData.get('displayName') ?? '').trim() || null
  const password = newPassword()

  try {
    const added = await createDirectorRoster().add(
      invitedBy,
      email,
      displayName,
      await hashPassword(password),
    )

    if (!added) {
      return { status: 'error', error: 'That address is already on a board.' }
    }
  } catch (error) {
    console.error('[directors] a director could not be added', error)

    return { status: 'error', error: 'That could not be saved just now. Try again in a moment.' }
  }

  return { status: 'added', email, password }
}

function newPassword(): string {
  return Array.from({ length: 4 }, () => randomBytes(6).toString('base64url')).join('-')
}
