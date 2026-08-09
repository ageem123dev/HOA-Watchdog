/**
 * A calendar date that exists.
 *
 * One statement, imported by `validate.ts` and `roll.ts`. It lived in both,
 * character for character, and `roll.ts`'s own docblock claimed it *reused* the
 * calendar check "rather than forking the project's single statement of it" —
 * which was true of `AMOUNT_PATTERN` beside it and false of this. Raised by
 * review, and the comment was the part that made it worth fixing rather than
 * tolerating: a duplicate nobody has noticed is cheap, and a duplicate the
 * documentation denies is how the next person stops checking.
 *
 * `2026-02-30` matches the format and is not a day, which is the whole reason
 * this is a function and not a regular expression.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isRealDate(value: string): boolean {
  const parts = ISO_DATE.exec(value)
  if (parts === null) return false

  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const asDate = new Date(Date.UTC(year, month - 1, day))

  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  )
}
