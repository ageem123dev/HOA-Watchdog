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

## Environment

Copy [`.env.example`](.env.example) to `.env.local` and fill in the two values from the Supabase
project's API settings:

```bash
cp .env.example .env.local
```

The application **builds and tests without them** — `npm run build` must never require credentials,
or the build gate stops being runnable by anyone who lacks a populated environment. What it cannot
do without them is sign anyone in: the sign-in surface reports that the installation is not
connected to its account service yet.

Board members are provisioned in the Supabase dashboard. There is deliberately no sign-up, password
reset, or invitation surface in the pilot — one association, a handful of directors.

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

[`core/security/nfr2-guard.test.ts`](core/security/nfr2-guard.test.ts) runs as part of `npm test`
and fails if anything matching a forbidden credential shape is present. The shapes it looks for, and
the reason each one is forbidden, are in
[`core/security/forbidden-credentials.ts`](core/security/forbidden-credentials.ts).

It reads four surfaces:

1. the environment of the process running it;
2. every `.env*` file on disk, **including git-ignored ones** — `.env` is git-ignored by design and
   is still loaded into the environment by `next build` and `next dev`, which makes it the most
   likely way a credential ever reaches a deploy unit;
3. tracked CI and example config, parsed both for assignments and for `${{ secrets.NAME }}`
   references, so renaming the variable a secret is mapped onto does not hide which secret is being
   reached for;
4. JSON config such as `vercel.json`, whose quoted keys no line-oriented parser can see.

Two things follow, and both are deliberate:

- **If the guard fails, remove the credential.** Do not add an exemption, and do not delete the
  test. Its removal is an architecture change requiring a new decision record, not a cleanup. The
  air-gap this product's safety claim rests on *is* the absence of these credentials — see AD-2 in
  the architecture spine.
- **The guard's limit is stated, not papered over.** It cannot see a secret that exists only in a
  hosting dashboard or in GitHub's secret store and is never referenced by tracked config nor mapped
  into this process's environment. GitHub Actions does not place repository secrets in a step's
  environment unless a workflow maps them, so surface 3 above — not the environment scan — is what
  gives the check reach over CI secrets: a secret no tracked workflow references cannot be used by
  one. Neither deploy unit's *runtime* environment is inspected.

The system does write to its own database — uploaded documents, extracted records, alerts and the
provenance log. NFR-2 constrains outbound writes to third-party systems of record, nothing else.
