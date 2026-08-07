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
 */
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

    if (sql[i] === "'") {
      out += "'"
      i += 1
      while (i < sql.length) {
        // '' is an escaped quote inside a literal, not the end of one.
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

    // A dollar-quoted body: `$$`, or a tagged `$tag$`. Kept verbatim.
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i))
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
