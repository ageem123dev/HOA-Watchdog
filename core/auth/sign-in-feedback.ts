/**
 * What sign-in tells a board member when it does not let them in.
 *
 * The reason travels in a query parameter, which means it is attacker-supplied:
 * anyone can hand a director a link carrying any value. The lookup is therefore
 * an explicit membership test over a frozen list rather than an index into an
 * object — `'toString' in MESSAGES` is true, and an object index would return a
 * function where a string was promised.
 */

export const SIGN_IN_REASONS = ['credentials', 'missing', 'unavailable', 'unconfigured'] as const

export type SignInReason = (typeof SIGN_IN_REASONS)[number]

/**
 * Copy per EXPERIENCE.md → Voice and Tone: plain language, says what to do next,
 * never apologises, never implies certainty the system lacks.
 *
 * `credentials` deliberately covers both an unknown address and a wrong password.
 * Distinguishing them would let an unauthenticated stranger confirm who sits on
 * the board, and an HOA roster is not theirs to enumerate.
 */
const MESSAGES: Readonly<Record<SignInReason, string>> = Object.freeze({
  credentials: "That email and password don't match an account.",
  missing: 'Enter your email address and password.',
  unavailable: "We couldn't reach the account service. Try again in a moment.",
  unconfigured: 'This installation is not connected to its account service yet.',
})

export function isSignInReason(raw: unknown): raw is SignInReason {
  return typeof raw === 'string' && (SIGN_IN_REASONS as readonly string[]).includes(raw)
}

/**
 * Returns `null` when there is nothing to report, and falls back to the
 * credentials message for anything unrecognised — an unknown reason means a
 * failed sign-in whose cause was not one this surface knows how to describe, and
 * the visitor is better served by the ordinary message than by a blank page.
 */
export function signInMessage(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  return isSignInReason(raw) ? MESSAGES[raw] : MESSAGES.credentials
}
