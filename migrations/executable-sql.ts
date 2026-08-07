/**
 * The executable part of a migration: its statements, with comments removed.
 *
 * Every migration test in this project matches patterns against migration text,
 * and these migrations explain their own hazards in prose — so a check for a bad
 * shape matches the sentence warning against it unless comments come out first.
 * Stories 1.6a and 1.6c each shipped a test that matched a migration's own
 * explanation rather than its SQL, and story 2.1 shipped a deny-list that failed
 * on a `comment on` literal describing the very thing it forbade.
 *
 * Shared rather than copied. Both of story 2.1's migration test files declared
 * their own version, and both handled only *leading* `--` lines: a trailing
 * comment on a code line survived, and `/* … *\/` blocks survived whole. No
 * assertion was wrong because no migration had either, which is precisely the
 * kind of latent hole that surfaces as a test failing for the wrong reason a
 * year later. Raised by review; fixed once, here.
 *
 * Quote-aware, because stripping naively would corrupt the thing it is meant to
 * preserve:
 *
 * - `--` inside a single-quoted literal is text, not a comment. `comment on`
 *   statements in these migrations carry prose that may contain one.
 * - `$$ … $$` bodies are kept whole. Migration 011's normalisation function
 *   lives in one, and it is exactly what the tests need to look at.
 * - Postgres block comments nest, so depth is counted rather than matched to the
 *   first `*\/`.
 *
 * Newlines inside stripped blocks are preserved, so anything reading the result
 * line by line still sees the original line structure.
 *
 * **Scope, stated so it stops expanding.** The input is the `.sql` files in this
 * directory, read with `readFileSync(…, 'utf8')`. That bounds what can arrive:
 * Node replaces invalid UTF-8 with U+FFFD, so no lone surrogate reaches it from
 * a file, and nothing here uses `E'…'`, a tagged dollar quote, or a non-ASCII
 * identifier. Four review rounds hardened the scanner against all of those
 * anyway — they are cheap and the helper is shared — but this is not a general
 * SQL parser and should not grow into one. Anything beyond "strip the comments
 * from the migrations in this repo" wants a real parser, not another branch.
 */
/**
 * The complete code point immediately before `at`, or `''` at the start.
 *
 * `sql[at - 1]` is a UTF-16 *code unit*, so for an astral character it returns
 * half a surrogate pair — and a lone surrogate matches no Unicode letter
 * property, which is the opposite of the truth about the character it came from.
 */
const precedingCodePoint = (sql: string, at: number): string => {
  if (at <= 0) return ''

  const unit = sql.charCodeAt(at - 1)
  const isLowSurrogate = unit >= 0xdc00 && unit <= 0xdfff
  // Paired with a real high surrogate, not merely preceded by something. A lone
  // low surrogate cannot arrive from `readFileSync(…, 'utf8')` — Node replaces
  // invalid sequences with U+FFFD — but a caller can hand one in, and slicing two
  // units blindly would return a letter *plus* the surrogate, so the caller's
  // property test would answer about the wrong character.
  //
  // Review also proposed anchoring the caller's regex (`/^…$/u`) as a second
  // guard against a two-character return. Both were tried; the anchor makes this
  // check unobservable, since a two-character string matches neither form, and
  // then neither guard can be made to fail on its own. Kept the one a test can
  // falsify — the same reasoning that deleted `not isempty(held_during)` from
  // migration 012.
  const pairedWithHigh =
    isLowSurrogate && at >= 2 && sql.charCodeAt(at - 2) >= 0xd800 && sql.charCodeAt(at - 2) <= 0xdbff

  return pairedWithHigh ? sql.slice(at - 2, at) : (sql[at - 1] ?? '')
}

export const executable = (sql: string): string => {
  let out = ''
  let i = 0
  let blockDepth = 0

  while (i < sql.length) {
    const two = sql.slice(i, i + 2)

    if (blockDepth > 0) {
      if (two === '/*') {
        blockDepth += 1
        i += 2
        continue
      }
      if (two === '*/') {
        blockDepth -= 1
        i += 2
        continue
      }
      // Keep the line structure of what was removed.
      if (sql[i] === '\n') out += '\n'
      i += 1
      continue
    }

    if (two === '/*') {
      blockDepth = 1
      i += 2
      continue
    }

    if (two === '--') {
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }

    // `E'…'` is an escape string constant, where a backslash escapes the next
    // character. In a plain `'…'` a backslash is literal, because
    // `standard_conforming_strings` is on. Handling them the same way would end
    // an escape string one character early at `\'` and leave the rest of it
    // being scanned as SQL — where a `--` in the text would then eat a real
    // statement. Nothing here uses `E'…'` today; migration 009 records why it is
    // avoided in stored expressions. Raised by review as a latent trap, which is
    // the same reason this whole helper exists.
    // The word boundary matters: `/^[Ee]'/` alone matches the `e'` at the end of
    // `else'b'`, which is ordinary SQL — a keyword followed by a literal. Scanned
    // as an escape string, a backslash inside would consume the closing quote and
    // the scanner would run past the literal's real end, reading the rest of the
    // statement as string content. Raised by review; no migration here triggers
    // it, and this helper is shared by every migration test.
    // `\w` is ASCII-only, and Postgres identifiers are not: `añe'b'` would put a
    // non-ASCII letter before the `e` and the boundary test would wrongly say
    // "not part of a word". Unicode property escapes instead.
    //
    // And the preceding *code point*, not the preceding code unit. An astral
    // character like `𐐀` is a surrogate pair in JavaScript, so `sql[i - 1]` is a
    // lone low surrogate — which `\p{L}` does not match even though the whole
    // character does. Both halves of this boundary check were found by review;
    // the second only after the first was fixed.
    const escapeString =
      /^[Ee]'/.test(sql.slice(i, i + 2)) && !/[\p{L}\p{N}_$]/u.test(precedingCodePoint(sql, i))
    if (escapeString) {
      out += sql.slice(i, i + 2)
      i += 2
      while (i < sql.length) {
        if (sql[i] === '\\') {
          out += sql.slice(i, i + 2)
          i += 2
          continue
        }
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''"
          i += 2
          continue
        }
        out += sql[i]
        const closing = sql[i] === "'"
        i += 1
        if (closing) break
      }
      continue
    }

    // Single-quoted literals and double-quoted identifiers behave the same way
    // for this purpose: the delimiter doubled is an escaped delimiter, not the
    // end. A `--` inside a quoted identifier is part of the name.
    if (sql[i] === "'" || sql[i] === '"') {
      // Narrowed to a literal rather than read back out of the string:
      // `sql[i]` is `string | undefined` under `noUncheckedIndexedAccess`, and a
      // non-null assertion here would be a claim rather than a fact.
      const quote = sql[i] === "'" ? "'" : '"'
      out += quote
      i += 1
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) {
          out += quote + quote
          i += 2
          continue
        }
        out += sql[i]
        const closing = sql[i] === quote
        i += 1
        if (closing) break
      }
      continue
    }

    // A dollar-quoted body: `$$`, or a tagged `$tag$`. Kept verbatim. The tag is
    // an identifier, and Postgres identifiers are not ASCII-only — the same
    // oversight the boundary check above had.
    const dollar = /^\$([\p{L}_][\p{L}\p{N}_]*)?\$/u.exec(sql.slice(i))
    if (dollar) {
      const tag = dollar[0]
      const end = sql.indexOf(tag, i + tag.length)
      const stop = end === -1 ? sql.length : end + tag.length
      out += sql.slice(i, stop)
      i = stop
      continue
    }

    out += sql[i]
    i += 1
  }

  return out
}
