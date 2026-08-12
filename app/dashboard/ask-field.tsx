/**
 * The ask field (story 3.6c, UX-DR7).
 *
 * The last piece of the path a board member actually walks: they open the
 * dashboard, they have a question, and they type it. Story 3.6b built the Oracle
 * and left it reachable only by editing an address bar, which nobody does.
 *
 * ## A plain GET form is the whole mechanism
 *
 * `<form action="/oracle" method="get">` with an input named `q`. The browser
 * navigates, the question is in the URL, and the Oracle renders with it already
 * asked.
 *
 * This satisfies UX-DR7's "no intermediate empty state, no second submit" **by
 * construction rather than by care**: there is no second request that could
 * produce an intermediate state. The obvious alternative — a client component
 * calling `useRouter().push()` — buys nothing here and costs the things this
 * gets for free: it works with JavaScript disabled, the back button behaves, the
 * browser URL-encodes the question so a `&` or `#` cannot truncate it, and the
 * answer becomes a linkable URL, which matters for a product whose evidence a
 * board member may want to send to somebody.
 *
 * It is therefore not a client component, and needs no props. `AnswerView` takes
 * props so its tests need no server; this needs neither.
 */

/**
 * At least one character that is not a space.
 *
 * With `required`, this is the whole of AC5: the browser refuses a blank or
 * whitespace-only question before any navigation happens, with no JavaScript
 * involved. `required` alone is not enough — it accepts `"   "`, which would
 * navigate to `/oracle?q=%20`, where the Oracle trims it back to empty and
 * renders its empty state. A submission that appears to have worked and did
 * nothing is precisely what AC5 forbids.
 *
 * **`\S`, and the corruption is caught rather than avoided.** The first version
 * of this used `.*[^ ].*` to dodge a backslash, because `\S` has twice arrived
 * on this project with the backslash eaten — including in this story's own probe,
 * where the attribute landed as `.*S.*`. Dodging it was the wrong trade: `[^ ]`
 * excludes only U+0020, so a pasted tab or non-breaking space passed validation
 * and navigated to an Oracle that trimmed the question back to empty and showed
 * its empty state. That is exactly the "appears to have worked" AC5 forbids, and
 * Argus caught it.
 *
 * A corrupted pattern still compiles and silently matches nothing, so it is
 * invisible in a diff and in a green suite — which is an argument for a test
 * that reads the rendered attribute, not for a weaker pattern. There is one.
 */
export const NON_BLANK_PATTERN = '.*\\S.*'

/**
 * The most-read copy in the product, and load-bearing.
 *
 * AD-5 fixes the catalog, so questions outside it fail by construction rather
 * than by accident. The placeholder is where most people will look for "what can
 * I ask?", which makes it the difference between a product that says what it
 * does and one that manufactures its own most common failure.
 *
 * The UX spec's example of the failure it prevents names four capabilities —
 * dues status, payment history, vendor totals, invoice comparisons. This catalog
 * holds **one**, `dues_status@1`: one unit, one assessment year. Three of those
 * four would be a lie the first time somebody tried them.
 *
 * So the placeholder is a question this catalog can answer, rather than a list of
 * subjects. An example teaches the shape and the scope in one line, and cannot
 * over-promise the way a list can.
 */
export const ASK_PLACEHOLDER = 'What does unit 4B owe for 2026?'

export function AskField() {
  return (
    <form action="/oracle" method="get" role="search" style={styles.form}>
      {/*
        A real label, not a placeholder doing a label's job. A placeholder
        disappears the moment somebody types, and a screen reader is then
        reading an unnamed field — the accessibility failure that is invisible
        to everyone who never turns one on.
      */}
      <label htmlFor="ask" style={styles.label}>
        Ask about the association&rsquo;s records
      </label>

      <div style={styles.row}>
        <input
          id="ask"
          type="search"
          name="q"
          placeholder={ASK_PLACEHOLDER}
          required
          pattern={NON_BLANK_PATTERN}
          style={styles.input}
        />
        <button type="submit" style={styles.submit}>
          Ask
        </button>
      </div>
    </form>
  )
}

/**
 * The same inline-token pattern the other surfaces use, per
 * `core/design/no-raw-values.test.ts`.
 *
 * Nothing here is positioned. AC3 permits a sticky field provided it reserves
 * scroll padding, and this story takes the other option the story file offers:
 * a field in normal flow satisfies every clause except "persistent", and AC3
 * exists only because sticky positioning is what creates the overlay hazard in
 * the first place. A sticky element covering a link is a link nobody can click,
 * and it does not show up in a screenshot taken at the top of the page.
 */
const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-base)',
    alignSelf: 'stretch',
  },
  label: {
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
  row: {
    display: 'flex',
    gap: 'var(--space-row)',
    alignItems: 'stretch',
  },
  input: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    minWidth: '24px',
    flex: '1 1 auto',
  },
  submit: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    minWidth: '44px',
    cursor: 'pointer',
  },
} as const
