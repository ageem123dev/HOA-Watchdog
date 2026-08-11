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
export function questionFrom(q: string | string[] | undefined): string {
  if (Array.isArray(q)) return q[0]?.trim() ?? ''

  return q?.trim() ?? ''
}
