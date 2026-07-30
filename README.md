# Fiduciary Watchdog

An AI condominium treasury assistant. A board uploads the association's invoices, bank statements
and assessment rolls; the system reads them into structured records, refuses to guess when a
document is ambiguous, answers questions with the underlying records on screen, and flags probable
duplicate invoices, unusual vendor billing and missed dues before the board pays.

Planning artifacts live in [`_bmad-output/planning-artifacts/`](_bmad-output/planning-artifacts/);
the product requirements are in [`docs/prd/prd.md`](docs/prd/prd.md).

## Prerequisites

- Node.js 24 or newer (`.github/workflows/ci.yml` pins CI to 24)

## Getting started

```bash
npm install
npm run dev
```

## The three gates

Every change must pass all three, locally and in CI:

```bash
npm run lint    # ESLint 9, flat config, eslint-config-next
npm run build   # Next.js production build, including TypeScript
npm test        # Vitest
```

CI runs them on every push and on every pull request into `main`. There is no `continue-on-error`
anywhere in the workflow: a failing test fails the pipeline.

## Layout

```text
app/     Next.js routes and UI
core/    Pure domain logic — depends on nothing, performs no I/O
```

The remaining directories from the architecture's source tree (`adapters/`, `catalog/`, `tools/`,
`agent/`) arrive with the stories that need them.

## NFR-2: no external write credentials

This project holds **no credential for any external financial rail** — no banking platform, no
payment processor, no external accounting or property-management system. That is not a policy
someone remembers to follow; it is a property the build checks.

[`core/security/nfr2-guard.test.ts`](core/security/nfr2-guard.test.ts) runs as part of `npm test`.
It reads the environment of the process running it plus the repository's tracked configuration
files, and fails if anything matching a forbidden credential shape is present. The shapes it looks
for, and the reason each one is forbidden, are in
[`core/security/forbidden-credentials.ts`](core/security/forbidden-credentials.ts).

Two things follow from that, and both are deliberate:

- **If the guard fails, remove the credential.** Do not add an exemption, and do not delete the
  test. Its removal is an architecture change requiring a new decision record, not a cleanup. The
  air-gap this product's safety claim rests on *is* the absence of these credentials — see AD-2 in
  the architecture spine.
- **The guard is scoped honestly.** It cannot see a secret that exists only in a hosting dashboard
  and is never injected into a build. CI is where deploy-unit secrets are injected in order to build
  and test, so the check has real reach there, but that limit is stated rather than papered over.

The system does write to its own database — uploaded documents, extracted records, alerts and the
provenance log. NFR-2 constrains outbound writes to third-party systems of record, nothing else.
