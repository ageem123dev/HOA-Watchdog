/**
 * What survives a token refresh, and what a token minted before a claim existed
 * does to the session built from it.
 *
 * Both rules are invisible in `auth.ts` — they are two `if`s inside callbacks
 * that only run inside Auth.js — and both fail silently when they are wrong: a
 * claim quietly reverts to `undefined` and every reader downstream sees a value
 * its type said could not arrive.
 */

import { describe, expect, it } from 'vitest'

import { applyClaimsToSession, applyClaimsToToken } from './session-claims'

const sessionFor = (user: { id?: string; associationId?: string } = {}) => ({ user: { ...user } })

describe('the claims carried onto a token at sign-in', () => {
  it('records the member id', () => {
    const token: { sub?: string; associationId?: string } = {}

    applyClaimsToToken(token, { id: 'member-1' })

    expect(token.sub).toBe('member-1')
  })

  it('records the association the member belongs to', () => {
    const token: { sub?: string; associationId?: string } = {}

    applyClaimsToToken(token, { id: 'member-1', associationId: 'association-a' })

    expect(token.associationId).toBe('association-a')
  })

  /**
   * Auth.js passes `user` on the sign-in call and on no other. A refresh that
   * read it unguarded would not fail to *update* the claims — it would
   * overwrite correct ones with `undefined`, so a member would lose their
   * association on the first page load after signing in and nothing would say
   * so.
   */
  it('leaves both claims alone on a refresh, where there is no user', () => {
    const token = { sub: 'member-1', associationId: 'association-a' }

    applyClaimsToToken(token, undefined)

    expect(token).toEqual({ sub: 'member-1', associationId: 'association-a' })
  })

  it('leaves both claims alone when the user carries no id', () => {
    const token = { sub: 'member-1', associationId: 'association-a' }

    applyClaimsToToken(token, { associationId: 'association-b' })

    expect(token).toEqual({ sub: 'member-1', associationId: 'association-a' })
  })
})

describe('the claims copied onto a session', () => {
  it('carries the member id through', () => {
    const session = sessionFor()

    applyClaimsToSession(session, { sub: 'member-1' })

    expect(session.user.id).toBe('member-1')
  })

  it('carries the association through', () => {
    const session = sessionFor()

    applyClaimsToSession(session, { sub: 'member-1', associationId: 'association-a' })

    expect(session.user.associationId).toBe('association-a')
  })

  /**
   * The eight-hour window this exists for. `SESSION_MAX_AGE_SECONDS` is
   * `60 * 60 * 8`, so on the day this ships every already-signed-in director
   * holds a token minted before `associationId` existed. Writing the absent
   * claim through would set the property to `undefined` — present, enumerable,
   * and typed `string`.
   */
  it('does not invent an association for a token minted before the claim existed', () => {
    const session = sessionFor()

    applyClaimsToSession(session, { sub: 'member-1' })

    expect(session.user.id).toBe('member-1')
    expect(Object.hasOwn(session.user, 'associationId')).toBe(false)
  })

  it('does not overwrite an association already on the session when the token has none', () => {
    const session = sessionFor({ associationId: 'association-a' })

    applyClaimsToSession(session, { sub: 'member-1' })

    expect(session.user.associationId).toBe('association-a')
  })
})
