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
  if (email === '') {
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
