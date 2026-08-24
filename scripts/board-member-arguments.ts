/**
 * The provisioning script's command line, parsed.
 *
 * Separate from `add-board-member.mjs` because that file connects to a database
 * on import and so cannot be imported by a test — the constraint
 * `verify-extraction.test.ts` records about its own probe. Parsing needs no
 * database, so it lives here and is tested properly rather than asserted as
 * text.
 *
 * The first version filtered `process.argv` in place with
 * `argv.slice(0, associationAt)`, which truncated at the flag: a display name
 * given after `--association "X"` was silently dropped, and putting the flag
 * first failed with a usage error for a well-formed command.
 */

export interface ProvisioningArguments {
  readonly email: string | null
  readonly displayName: string | null
  readonly associationName: string | null
  /** `--association` given with nothing usable after it. */
  readonly missingAssociationValue: boolean
}

/** TypeScript, imported straight into the `.mjs` script the way `core/auth/password.ts` already is. */
export function parseArguments(argv: readonly string[]): ProvisioningArguments {
  const at = argv.indexOf('--association')

  // The value only counts if it is there and is not itself a flag. `--association`
  // last on the line would otherwise read as "no association given" and fall back
  // to the every-association query, which is a different command than the one
  // that was typed.
  const candidate = at === -1 ? null : (argv[at + 1] ?? null)
  const value = candidate === null || candidate.startsWith('--') ? null : candidate

  const positional = argv.filter((_argument: string, index: number) => {
    if (at === -1) return true
    if (index === at) return false
    return !(value !== null && index === at + 1)
  })

  const [email, ...nameParts] = positional

  return {
    email: email ?? null,
    displayName: nameParts.join(' ') || null,
    associationName: value,
    missingAssociationValue: at !== -1 && value === null,
  }
}
