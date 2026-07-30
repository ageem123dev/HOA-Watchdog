import type { ConfigEntry } from './config-entries'

export interface ForbiddenCredentialPattern {
  readonly id: string
  readonly rail: string
  readonly namePattern?: RegExp
  readonly valuePattern?: RegExp
  readonly reason: string
}

export interface CredentialViolation {
  readonly source: string
  readonly name: string
  readonly patternId: string
  readonly matchedOn: 'name' | 'value'
  readonly reason: string
}

/**
 * Credential shapes that would put this system on an external financial rail.
 *
 * Two properties matter more than breadth. The table must be specific enough
 * that this project's own domain vocabulary — bank statements, payment due
 * dates, assessment periods — never trips it, because a guard that cries wolf
 * is a guard someone deletes. And no matcher carries the global flag, whose
 * `lastIndex` would make results depend on which entry was tested before.
 */
export const FORBIDDEN_CREDENTIAL_PATTERNS: readonly ForbiddenCredentialPattern[] = [
  {
    id: 'stripe',
    rail: 'Stripe',
    namePattern: /^STRIPE_/i,
    valuePattern: /\b[sr]k_(live|test)_[0-9A-Za-z]{10,}/,
    reason:
      'Stripe is a payment processor. A key of either mode means a payment rail exists to write to.',
  },
  {
    id: 'plaid',
    rail: 'Plaid',
    namePattern: /^PLAID_/i,
    reason: 'Plaid is a banking-data rail. Deposit data reaches this system by upload instead.',
  },
  {
    id: 'accounting-system',
    rail: 'QuickBooks / Intuit',
    namePattern: /^(QUICKBOOKS|QBO|INTUIT)_/i,
    reason:
      'QuickBooks and Intuit are external systems of record. This system never writes back to one.',
  },
  {
    id: 'property-management',
    rail: 'AppFolio',
    namePattern: /^APPFOLIO_/i,
    reason: 'AppFolio is an external property-management system of record.',
  },
  {
    id: 'ach-processor',
    rail: 'Dwolla',
    namePattern: /^DWOLLA_/i,
    reason: 'Dwolla is an ACH payment processor.',
  },
  {
    id: 'banking-rail',
    rail: 'a banking network',
    namePattern: /^(BANK|ACH|WIRE|NACHA|SWIFT|SEPA)_(API|CLIENT|SECRET|TOKEN|KEY|CREDENTIAL|ACCESS|PRIVATE)/i,
    reason: 'A banking-network credential. There is no rail here to authenticate against.',
  },
  {
    id: 'payment-processor',
    rail: 'a payment processor',
    namePattern: /^(PAYPAL|SQUARE|ADYEN|BRAINTREE|WORLDPAY|AUTHORIZENET)_/i,
    reason: 'A payment-processor credential.',
  },
  {
    id: 'payment-rail',
    rail: 'a payment or payout rail',
    namePattern: /^(PAYMENT|PAYOUT)_(API|CLIENT|SECRET|TOKEN|KEY|CREDENTIAL|ACCESS|PRIVATE|PROCESSOR|GATEWAY)/i,
    reason:
      'A payment or payout credential. Domain names such as PAYMENT_DUE_DAY are deliberately not matched.',
  },
  {
    id: 'external-write-token',
    rail: 'an external system of record',
    namePattern: /_(WRITE_KEY|WRITE_TOKEN|WRITE_SECRET|WRITE_CREDENTIAL)$/i,
    reason: 'A write credential for an external system. This system writes only to its own store.',
  },
]

function assertIsConfigEntry(entry: ConfigEntry): void {
  if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') {
    throw new TypeError('findForbiddenCredentials expects entries with a string name')
  }
}

export function findForbiddenCredentials(entries: readonly ConfigEntry[]): CredentialViolation[] {
  if (!Array.isArray(entries)) {
    throw new TypeError('findForbiddenCredentials expects an array of config entries')
  }

  const violations: CredentialViolation[] = []

  for (const entry of entries) {
    assertIsConfigEntry(entry)

    for (const pattern of FORBIDDEN_CREDENTIAL_PATTERNS) {
      if (pattern.namePattern?.test(entry.name) === true) {
        violations.push({
          source: entry.source,
          name: entry.name,
          patternId: pattern.id,
          matchedOn: 'name',
          reason: pattern.reason,
        })
      }

      if (entry.value !== undefined && pattern.valuePattern?.test(entry.value) === true) {
        violations.push({
          source: entry.source,
          name: entry.name,
          patternId: pattern.id,
          matchedOn: 'value',
          reason: pattern.reason,
        })
      }
    }
  }

  return violations
}

/**
 * Renders violations for a human. Deliberately reports the entry's *name* and
 * never its value — a failure message is written to a CI log, and a guard that
 * leaks the secret it caught has done more harm than the secret sitting unnoticed.
 */
export function describeViolations(violations: readonly CredentialViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.source} → ${violation.name} (matched on ${violation.matchedOn}, pattern "${violation.patternId}"): ${violation.reason}`,
    )
    .join('\n')
}
