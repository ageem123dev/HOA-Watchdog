/**
 * One CSV cell, safe to open in a spreadsheet.
 *
 * ## Formula injection is the reason this is a module and not a template string
 *
 * The destination is Excel or Numbers on a board member's laptop, and a cell
 * beginning `=`, `+`, `-` or `@` is a **formula**, not text. Spreadsheets have
 * executed those on open for decades, and `=cmd|'/c calc'!A1` is the standard
 * demonstration.
 *
 * That matters more here than in most exports, because both files built from
 * this are made of text people outside the board influenced. The access log
 * records the values bound into a query — a unit number a member typed. The
 * reviewed register carries vendor names and unit numbers lifted straight off
 * documents the association received in the post. Quoting alone does not help:
 * a spreadsheet strips the quotes and then reads the formula.
 *
 * ## Why it lives here rather than beside either caller
 *
 * It was written for the access log (story 3.8) and paid for twice in review —
 * once for the full-width forms, once for leading whitespace. Story 4.7 needed
 * the same neutralisation for the register's export, and the story is explicit
 * that a second copy is not acceptable: two implementations of this become two
 * answers to "is this cell dangerous", and only one of them stays correct.
 *
 * Extracted rather than imported across domains, because a findings module
 * reaching into `core/provenance/access-log-csv` for its escaping would be a
 * dependency that reads as an accident.
 */

/**
 * What a spreadsheet reads as the start of a formula.
 *
 * The full-width forms are here too, and they are not decoration: Excel with a
 * Japanese IME converts a leading full-width ＝ into a formula, so a payload
 * written that way walks past a filter that only knows the ASCII four. Raised by
 * CodeRabbit.
 */
const FORMULA_LEADERS = new Set(['=', '+', '-', '@', '＝', '＋', '－', '＠'])

/**
 * One CSV cell: neutralised, then quoted.
 *
 * The order matters. Neutralising after quoting would put the tab outside the
 * quotes, where it is a delimiter rather than part of the value.
 */
export function cell(value: unknown): string {
  const text = stringify(value)
  // A tab, not an apostrophe. The apostrophe trick is more common and it is
  // worse: Excel hides it but LibreOffice and every plain-text reader show a
  // stray quote in front of every affected value, and these are documents
  // people read as records.
  const safe = startsFormula(text) ? `\t${text}` : text

  return `"${safe.replaceAll('"', '""')}"`
}

/**
 * The code point below which everything is a C0 control, and DEL.
 *
 * Named rather than inlined for the reason `core/auth/route-policy.ts` gives
 * for its own copy of this: a regex character class covering them needs either
 * literal control characters in the source — a hazard in its own right, and one
 * this repository has shipped three times — or escapes that are easy to get
 * subtly wrong. A code-point scan needs neither.
 */
const FIRST_PRINTABLE_CODE_POINT = 0x20
const DELETE_CODE_POINT = 0x7f

/**
 * Whether a spreadsheet would skip this character before deciding what the cell
 * is: whitespace, or a control byte.
 *
 * `trimStart()` handles the first and only the first. A control character is
 * not Unicode whitespace, so a value beginning with one survives the trim with
 * an ordinary-looking first character and walks past a check that only trims —
 * while the spreadsheet skips the byte and evaluates the formula behind it.
 *
 * Vertical tab and form feed are *already* whitespace to `trimStart`, which is
 * why only part of the range was reachable. The class is closed here rather
 * than the two members that happened to be found. Raised by Argus.
 *
 * Postgres `text` cannot store a NUL, so that payload cannot arrive from the
 * database; the rest of the range can.
 */
function skippable(character: string): boolean {
  const code = character.codePointAt(0) ?? 0

  return character.trim() === '' || code < FIRST_PRINTABLE_CODE_POINT || code === DELETE_CODE_POINT
}

/**
 * Whether a value would be read as a formula, **after anything skippable**.
 *
 * An earlier version tested `charAt(0)` and was bypassed by a leading space;
 * the one after it trimmed whitespace and was bypassed by a leading control
 * byte. Both were raised in review, and the mistake had the same shape each
 * time: guarding the characters that had been thought of rather than the ones a
 * spreadsheet ignores.
 *
 * The check skips; **the value does not**. Prefixing the original preserves the
 * record byte for byte — these are records, and a defence that quietly edited
 * what somebody typed would be its own kind of falsification.
 */
function startsFormula(text: string): boolean {
  for (const character of text) {
    if (skippable(character)) continue

    return FORMULA_LEADERS.has(character)
  }

  return false
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)

  return String(value)
}

/**
 * Rows joined into a file.
 *
 * CRLF line endings, because that is what RFC 4180 specifies and what Excel
 * expects; a lone LF is read as one enormous row by some versions.
 */
export function csvFile(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n')
}
