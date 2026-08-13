/**
 * The shape a finding's id has, checked before Postgres is asked to cast it.
 *
 * `finding.id` is a `uuid`, so a malformed value raises 22P02 on the cast — and
 * these ids come straight off a URL path or a form field, where anything at all
 * is reachable by typing. The honest answer to "is there a finding here" is
 * *no*, not a database error surfaced to a board member.
 *
 * **One definition, two callers.** The reader checks it so a bad path segment
 * cannot become a 500; the review action checks it so a bad id cannot be
 * reported as "the register could not be reached", which would name the wrong
 * thing as broken. A second copy of this regex is how the two would eventually
 * disagree about what an id is.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isFindingId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}
