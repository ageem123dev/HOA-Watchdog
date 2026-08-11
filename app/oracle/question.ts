/**
 * The question, from a search parameter that is not necessarily a string.
 *
 * `?q=a&q=b` gives Next.js an **array**, and `.trim()` on an array is a
 * `TypeError` — a 500 anybody can trigger by typing a URL. The page's type
 * annotation said `string`, which is why nothing complained: a type describes
 * the request a friendly caller makes, not the ones that actually arrive.
 * Raised by Argus.
 *
 * The first value wins rather than the whole request being refused. Two `q`
 * parameters is a malformed link, not an attack, and the reader almost certainly
 * meant the first.
 *
 * **In its own module, away from `page.tsx`.** Importing the page to test this
 * pulls `auth` → `next-auth` → `next/server` into the suite, and the file stops
 * loading at all — the failure story 1.6c's `QueueList` records in its own
 * header. A pure function has no business living behind that import.
 */
/**
 * The longest a question may be.
 *
 * A question is a sentence. The agent already refuses a body past 64 KB, but
 * that is a round trip and a model prompt away — bounding here means an absurd
 * URL costs nothing. Truncated rather than rejected: a question clipped at 500
 * characters still asks something, and story 3.6c's field will keep anyone
 * honest from reaching this at all. Raised by CodeRabbit.
 */
export const MAX_QUESTION_LENGTH = 500

export function questionFrom(q: string | string[] | undefined): string {
  const raw = Array.isArray(q) ? q[0] : q

  return (raw?.trim() ?? '').slice(0, MAX_QUESTION_LENGTH)
}
