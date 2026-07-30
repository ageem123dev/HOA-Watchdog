---
baseline_commit: 9d0a6951e72699dfe7fbdb749b636656cfd80fc4
---

# Story 1.1: Project scaffold with a verified build

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer on this project,
I want a scaffolded application with lint, build, and tests running in CI from the first commit,
so that every later change is verified before it ships rather than after something breaks.

## Acceptance Criteria

**AC1 — The application builds**

**Given** an empty repository
**When** the scaffold story is complete
**Then** a Next.js 16.2.x application with TypeScript builds successfully

**AC2 — A real test runner exists**

**And** Vitest is installed with at least one passing test

**AC3 — CI runs all three gates on every push**

**And** `npm run lint`, `npm run build`, and `npm test` all run in CI on every push

**AC4 — The pipeline is not decorative**

**And** a failing test fails the pipeline

**AC5 — NFR-2 credential assertion**

**Given** the CI pipeline
**When** it runs
**Then** it asserts that no environment variable, secret, or configuration value matching a banking,
payment-processor, or external-accounting credential pattern exists in any deploy unit
**And** the pipeline fails if one is introduced
**And** this assertion is documented as enforcing NFR-2, so a future contributor understands why
removing it is not a cleanup

## Tasks / Subtasks

- [x] **Task 1 — Repository hygiene before any install** (AC: 1)
  - [x] Add a root `.gitignore` covering `node_modules/`, `.next/`, `out/`, `coverage/`,
        `*.tsbuildinfo`, `.env`, `.env*.local`, `.DS_Store`.
        There is **no root `.gitignore` today** — `.agents/`, `_bmad/` and `_bmad-output/` are all
        tracked. Do **not** add ignore rules for those; they are committed on purpose.
  - [x] Confirm `git status` is clean of `node_modules` noise after `npm install`.

- [x] **Task 2 — Next.js + TypeScript scaffold** (AC: 1)
  - [x] `package.json` with pinned-range deps (see *Library & Framework Requirements*).
  - [x] App Router at **`app/`** in the repository root. **No `src/` directory** — the architecture
        source tree places `app/`, `core/`, `adapters/`, `catalog/`, `tools/`, `agent/` at the root.
  - [x] `app/layout.tsx` + `app/page.tsx`. Keep the page minimal — Story 1.3 owns the visual
        foundation and design tokens; do **not** invent colors, fonts, or a component library here.
  - [x] `tsconfig.json` with `strict: true`, `paths` alias `@/*` → `./*`, `moduleResolution: "bundler"`.
  - [x] `next.config.ts`.
  - [x] Verify `npm run build` succeeds.

- [x] **Task 3 — ESLint flat config** (AC: 3)
  - [x] `eslint.config.mjs` (flat config) composing `eslint-config-next` + its `typescript` and
        `core-web-vitals` entry points. Inspect the installed `eslint-config-next/dist/index.d.ts`
        to confirm whether each entry point exports a flat-config array or a single object, and wire
        accordingly — do not guess.
  - [x] `"lint": "eslint ."` in `package.json`. Do **not** wire `next lint` (deprecated since 15.3,
        removed in 16). Ignore `.next/`, `node_modules/`, `coverage/` in the flat config.
  - [x] Verify `npm run lint` exits 0 on the scaffold.

- [x] **Task 4 — Vitest harness** (AC: 2, 4)
  - [x] Install `vitest` as the only test dependency. Vitest 4 already depends on `vite`; do **not**
        add `vite` separately. Do **not** add `@testing-library/react`, `jsdom`, or `happy-dom` —
        no story yet needs a component test, and the first story that does will add them.
  - [x] `vitest.config.ts` with `environment: 'node'`, `include: ['**/*.test.ts']`,
        `exclude` covering `node_modules`, `.next`, `.agents`, `_bmad`.
  - [x] `"test": "vitest run"` in `package.json`.
  - [x] At least one genuinely passing test (Task 5's unit tests satisfy this — a placeholder
        `expect(true).toBe(true)` does **not** count and must not be committed).

- [x] **Task 5 — NFR-2 forbidden-credential detector (pure domain logic)** (AC: 5)
  - [x] `core/security/forbidden-credentials.ts` — a **pure** module, no I/O, no `process.env`
        access, no `fs`. Exports:
        - `FORBIDDEN_CREDENTIAL_PATTERNS` — the pattern table, each entry carrying `id`,
          `pattern` (RegExp), and `reason` (human-readable, names the rail).
        - `findForbiddenCredentials(entries: ConfigEntry[]): CredentialViolation[]` where
          `ConfigEntry = { source: string; name: string; value?: string }` and
          `CredentialViolation = { source: string; name: string; patternId: string; reason: string }`.
  - [x] Match on **both** the entry name and, when present, the value — a key named `MISC_TOKEN`
        holding `sk_live_...` must be caught.
  - [x] Cover at minimum: Stripe (`sk_live_`, `rk_live_`), Plaid (`PLAID_SECRET`,
        `PLAID_CLIENT_ID`), QuickBooks / Intuit (`QUICKBOOKS_`, `INTUIT_`), AppFolio (`APPFOLIO_`),
        Dwolla, generic `BANK_*` / `ACH_*` / `PAYMENT*` / `PAYOUT*` write-token shapes, and
        `*_WRITE_KEY` / `*_WRITE_TOKEN` on any of the above.
  - [x] **Must not** flag this project's own legitimate secrets — the reasoning-model key, the
        extraction-model key, or Supabase keys. Write an explicit test asserting
        `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
        `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` are **not** violations.
        A guard that cries wolf gets deleted; that is the failure mode NFR-2 cannot survive.
  - [x] `core/security/forbidden-credentials.test.ts` — unit tests for the pure function.

- [x] **Task 6 — NFR-2 guard test (the CI assertion itself)** (AC: 5)
  - [x] `core/security/nfr2-guard.test.ts` — collects real config entries and asserts zero
        violations. Sources it must scan:
        1. `process.env` **names** (and values) of the running CI/dev shell.
        2. Every git-tracked file matching `.env*` (there should be none), `.github/workflows/*.yml`,
           `vercel.json`, and any `*.env.example`.
  - [x] It must **fail loudly with the violating source, name, and reason** — not just `expect(0)`.
  - [x] Read files via the git index (`git ls-files`) or a bounded directory walk, **never** an
        unbounded recursive walk that would descend into `node_modules/` or `.agents/`.
  - [x] Head the file with a comment block: what NFR-2 is, that this test is the enforcement
        mechanism named in AD-2, and that removing or weakening it is an architecture change
        requiring a new AD — not a cleanup. Reference `AD-2` and `NFR-2` by name.

- [x] **Task 7 — CI workflow** (AC: 3, 4, 5)
  - [x] `.github/workflows/ci.yml` — triggers on `push` (all branches) and `pull_request` targeting
        `main`. This story's epic branch relies on push-triggered CI as its integration gate.
  - [x] Single job on `ubuntu-latest`: `actions/checkout@v5`, `actions/setup-node@v5` with
        `node-version: '24'` and `cache: 'npm'`, `npm ci`, then **three named steps**:
        `npm run lint`, `npm run build`, `npm test`.
  - [x] Name the test step so the NFR-2 role is visible in the CI log, e.g.
        `Test (includes the NFR-2 no-write-credential assertion)`.
  - [x] Do **not** add `continue-on-error` to any gate. Do **not** add a `pytest` job — there is no
        Python code until Epic 2 (see *Scope boundaries*).

- [x] **Task 8 — Prove the pipeline is not decorative** (AC: 4)
  - [x] Locally: temporarily invert one assertion, confirm `npm test` exits non-zero, revert.
        Record the observed exit code / output in the Dev Agent Record. Do **not** commit the
        inverted test.
  - [ ] After the epic branch is pushed, confirm the CI run is green and record the run URL.

- [x] **Task 9 — Documentation** (AC: 5)
  - [x] `README.md` with: what the project is (one paragraph), prerequisites (Node 24), the three
        commands (`npm run lint` / `npm run build` / `npm test`), and a short **"NFR-2: no external
        write credentials"** section pointing at `core/security/` and stating that the guard is a
        binding architectural constraint, not lint noise.

## Dev Notes

### Scope boundaries — what this story does NOT do

Building any of these here is scope creep and will be flagged in review:

- **No auth, no Supabase client, no database.** Story 1.2 owns sign-in; Story 1.4 owns the DB roles
  and storage. Adding a Supabase client now makes `next build` require `NEXT_PUBLIC_SUPABASE_*` and
  breaks CI for no benefit.
- **No design tokens, no CSS system, no components.** Story 1.3 owns the visual foundation from
  `DESIGN.md`. `app/page.tsx` should be near-empty text.
- **No `core/` domain modelling** beyond `core/security/`. The entities in the architecture ER
  diagram arrive with the stories that need them.
- **No Python service and no pytest job.** The epic overview line "both test harnesses in CI" is
  superseded by the epic's own recorded assumption #3: the Python agent service does not exist
  until Epic 2 needs it, and the principle is to create things only when a story requires them.
  The pytest harness and its CI job land with the first Python code. Note this decision in the
  Completion Notes so the next reader does not treat it as an omission.

### Architectural constraints that bind this story

| Constraint | Source | What it means here |
| --- | --- | --- |
| **AD-2** — the air-gap is an absence, not a permission | Architecture spine | The NFR-2 guard is the *named enforcement mechanism* for AD-2. The spine's Consistency Conventions say verbatim: "The *absence* of write credentials (AD-2) is asserted by a CI check, not left to convention." |
| **AD-2** — internal writes are allowed | Architecture spine | Do not build a guard that forbids all writes or all secrets. The system owns and writes its own store. Only **external financial rails** are forbidden. |
| Source tree | Architecture spine §Structural Seed | `app/`, `core/`, `adapters/`, `catalog/`, `tools/`, `agent/` at root. No `src/`. |
| Layer dependency direction | Architecture spine §Design Paradigm | `core/` depends on **nothing**. `core/security/forbidden-credentials.ts` must therefore import nothing from `app/` or `adapters/` and must not touch `fs` or `process`. The *test* may do I/O; the module may not. |
| Money / dates / ids conventions | Architecture spine §Consistency Conventions | Not exercised by this story, but do not introduce a competing convention. |
| Tests | Architecture spine §Consistency Conventions | "Vitest for the Node/Next side… Test-first per `bmad-dev-tdd`." |

### Known variance from the architecture source tree

The spine's source tree does not list `.github/` or a `README.md`. Both are required by this
story's ACs and are conventional repository furniture, not architecture. Record this in the
story's Project Structure Notes; no AD change is needed.

### The NFR-2 guard's honest boundary

State this in the README and in the guard's header comment: the check sees the **CI runner's
environment and the repository's tracked configuration**. It cannot read a secret that exists only
in a Vercel or container-host dashboard and is never injected into CI. That is a real limit, and
naming it is better than implying coverage the check does not have. CI is nonetheless where
deploy-unit secrets are injected for build and test, so the check has real teeth.

### Test-first shape for this story

`bmad-dev-tdd` drives the order. The natural red/green sequence:

1. `findForbiddenCredentials` returns violations for a known-bad entry list → red → implement.
2. `findForbiddenCredentials` returns `[]` for this project's legitimate keys → red → widen/narrow
   patterns.
3. Value-based match (bad value under an innocuous name) → red → implement.
4. `nfr2-guard.test.ts` against the real repository → should pass immediately; if it does not, the
   repository has a problem this story just found — fix the repository, never the pattern table.

Failure-mode analysis worth writing down before coding: a pattern table that is too broad makes the
guard noisy and it gets deleted; too narrow and it is theatre. The false-positive test in step 2 is
the load-bearing one.

### Testing standards

- `npm test` = `vitest run`. Tests are `*.test.ts` colocated with their module.
- Every gate must be green before commit: `npm run lint` **and** `npm run build` **and** `npm test`.
- Never weaken, skip, or delete a test to reach green.

## Project Structure Notes

Expected tree after this story:

```text
HOA-Treasurer-Assistant/
  .github/workflows/ci.yml       # NEW — variance from spine source tree (conventional)
  .gitignore                     # NEW
  README.md                      # NEW — variance from spine source tree (conventional)
  app/
    layout.tsx                   # NEW
    page.tsx                     # NEW
  core/
    security/
      config-entries.ts          # NEW — pure; normalises env, text and JSON config into ConfigEntry
      config-entries.test.ts
      forbidden-credentials.ts   # NEW — pure, no I/O
      forbidden-credentials.test.ts
      nfr2-guard.test.ts         # NEW — the CI assertion for NFR-2 / AD-2
  eslint.config.mjs              # NEW
  next.config.ts                 # NEW
  package.json                   # NEW
  tsconfig.json                  # NEW
  vitest.config.ts               # NEW
```

Existing tracked directories `_bmad/`, `_bmad-output/`, `.agents/`, `docs/` and `.coderabbit.yaml`
stay tracked and untouched. `.claude/` is partially tracked (skills only) — do not add ignore rules
that would untrack it.

## Library & Framework Requirements

Verified against the npm registry on 2026-07-30.

| Package | Version | Why |
| --- | --- | --- |
| `next` | `16.2.12` | Latest 16.2.x; spine binds "16.2.x (16.2.11 Active LTS)". |
| `react` / `react-dom` | `19.2.8` | Next 16 peer range is `^19.0.0`. |
| `typescript` | `~5.9.3` | **Spine binds TypeScript 5.x.** See the note below. |
| `@types/node` | `^26.1.2` | Node 24 runtime. |
| `@types/react` | `^19.2.17` | Matches React 19.2.x. |
| `@types/react-dom` | `^19.2.3` | Its published versions lag `@types/react`; `19.2.3` is the latest. |
| `eslint` | `^10.8.0` | `eslint-config-next` peer is `>=9.0.0`. |
| `eslint-config-next` | `16.2.12` | Must track the `next` version. Brings `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y` transitively — **do not install those separately**. |
| `vitest` | `^4.1.10` | Depends on `vite` itself; `@types/node` peer is `>=24.0.0`, satisfied. |

**TypeScript version — deliberate, not stale.** npm `latest` for `typescript` is now **7.0.2** (the
rewritten compiler). This story pins **5.9.3** because (a) the architecture spine binds "TypeScript
5.x" and changing a bound stack entry is an architecture change, not a scaffold decision, and
(b) `eslint-config-next@16.2.12` depends on `typescript-eslint@^8.46.0`, which is built against the
TS 5 compiler API. Adopting TS 7 here would be an unreviewed stack change with a live lint
dependency risk. If TS 7 is wanted, it is a spine amendment and its own story. **Say so in the
Completion Notes** rather than silently pinning.

Keep the dependency list to exactly the table above. Every extra dependency in a scaffold is one a
later reviewer has to justify.

## Latest Technical Information

- **Next.js 16 removed `next lint`** (deprecated in 15.3). Lint must be invoked as `eslint .`
  against a flat `eslint.config.mjs`. If the installed CLI still accepts `next lint`, direct ESLint
  is still the required wiring — verify empirically and note what you observed.
- **`eslint-config-next@16.2.12` entry points** are `.`, `./typescript`, and `./core-web-vitals`
  (confirmed from the published `exports` map). Read the installed `.d.ts` to determine array vs.
  object shape before composing the flat config.
- **Vitest 4** lists `vite` in its own `dependencies`, so a separate `vite` devDependency is
  redundant.
- **Node 24.14.1** is the local runtime; pin CI to `node-version: '24'` so local and CI agree.
- `actions/checkout@v7` and `actions/setup-node@v7` are the current major versions (verified against
  the GitHub releases API on 2026-07-30). Using an older major will produce a runtime deprecation
  annotation in the run log.

## References

- Story statement and acceptance criteria: [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1: Project scaffold with a verified build]
- Epic 1 objectives and cross-story scope: [Source: _bmad-output/planning-artifacts/epics.md#Epic 1: Trusted intake — get the records in, and see what was read]
- Recorded assumption #3 (Python service deferred to Epic 2): [Source: _bmad-output/planning-artifacts/epics.md#Recorded assumptions (approved 2026-07-30 without amendment)]
- NFR-2 wording: [Source: docs/prd/prd.md#6.1 Structural Air-Gap & Database Security]
- AD-2 (air-gap is an absence; CI check is the enforcement): [Source: _bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29/ARCHITECTURE-SPINE.md#AD-2 — The air-gap is an absence, not a permission]
- Layer → namespace mapping and `core/` dependency rule: [Source: .../ARCHITECTURE-SPINE.md#Design Paradigm]
- Stack versions: [Source: .../ARCHITECTURE-SPINE.md#Stack]
- Source tree: [Source: .../ARCHITECTURE-SPINE.md#Structural Seed]
- Test and config conventions: [Source: .../ARCHITECTURE-SPINE.md#Consistency Conventions]

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Opus 5, 1M context) — `bmad-dev-tdd`

### Test Design

Three behaviors carry logic in this story. The scaffold itself (Tasks 1–4, 7, 9) is configuration
whose only meaningful assertion is that the three gates run and can fail — verified in Task 8
rather than by unit tests.

#### Behavior A — `entriesFromEnv(source, env)`

1. *Observable signal:* returns one `ConfigEntry` per own enumerable key, order-preserving.
2. *Seams:* none needed — the environment is a parameter, not `process.env`. That is the whole
   reason the function exists rather than reading the environment itself.
3. *Failure modes:*

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| A1 | `env` is `null` or a non-object | GUARD | `rejects a non-object environment rather than silently reporting nothing` |
| A2 | A declared-but-unset variable has value `undefined` | GUARD — emit name-only entry | `keeps a variable whose value is undefined, reporting the name alone` |
| A3 | Empty environment | GUARD — return `[]` | `returns no entries for an empty environment` |
| A4 | Inherited prototype properties leak in as entries | GUARD — `Object.entries` is own-keys-only | `ignores inherited properties so a polluted prototype cannot inject an entry` |

4. *Same defect shape elsewhere:* any future code enumerating a config object. None exists yet.

#### Behavior B — `entriesFromText(source, content)`

1. *Observable signal:* the parsed entry list.
2. *Seams:* content is passed in as a string; the caller owns the file read.
3. *Failure modes:*

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| B1 | Non-string content | GUARD — `TypeError` | `rejects non-string content rather than silently reporting nothing` |
| B2 | Comment lines parsed as assignments | GUARD | `skips comment lines` |
| B3 | Lines with no delimiter | GUARD | `skips blank lines and lines with no delimiter` |
| B4 | Quoted values keep their quotes | GUARD | `strips matching surrounding quotes from a value` |
| B5 | An unmatched quote truncates the value | GUARD | `keeps an unmatched quote as part of the value rather than truncating it` |
| B6 | `export NAME=value` shell prefix | GUARD | `strips a leading export so shell-style files parse` |
| B7 | Value containing the delimiter (`postgres://u:p@h/db?a=b`) split too many times | GUARD — fencepost | `splits on the first delimiter only, so a value may contain one` |
| B8 | CRLF line endings leak `\r` into the value | GUARD | `does not leak a carriage return into the value on CRLF files` |
| B9 | Indented YAML-style `KEY: value` | GUARD | `parses YAML-style KEY: VALUE lines, ignoring indentation` |
| B10 | Empty value confused with absent value | GUARD | `records an empty value as present-but-empty rather than absent` |
| B11 | Orphaned `=value` with no name | GUARD | `skips a line whose name is empty` |
| B12 | Pathologically large file | OUT-OF-SCOPE | The caller chooses which files to read, and the pathspec list is narrow and fixed. Handled at the call site in `nfr2-guard.test.ts`. |

B8 is not hypothetical here: this repository is developed on Windows and Git reports CRLF
conversion on every commit.

4. *Inverse test:* `round-trips: rendering entries and re-parsing yields the same entries`. The
   renderer lives in the test file so no production code ships that only the suite calls.

#### Behavior C — `findForbiddenCredentials(entries)`

1. *Observable signal:* the violation list; `[]` means compliant.
2. *Seams:* none — a pure function over a data table.
3. *Failure modes:*

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| C1 | Non-array argument | GUARD — `TypeError` | `rejects a non-array argument rather than silently reporting nothing` |
| C2 | Entry missing a `name` | GUARD — `TypeError`, not a silent skip | `rejects a malformed entry rather than skipping it` |
| C3 | **False positives on this project's own vocabulary** | GUARD | 14 permitted names, each with its own case, plus `reports no violations for an environment holding only permitted names` |
| C4 | A forbidden key under an innocuous name | GUARD — value matching | `flags a payment-processor key hidden under an innocuous name` |
| C5 | Case variation in names | GUARD | `matches names case-insensitively` |
| C6 | Global-flagged regex `lastIndex` making results depend on evaluation order | GUARD — asserted structurally on the table | `uses no global-flagged matcher…` + `is stable across repeated calls…` |
| C7 | Only the first violation reported | GUARD — zero/one/many | `reports every violating entry, not just the first`, `finds a violation at the end of a long clean list` |
| C8 | Entry with no value crashing the value matcher | GUARD | `reports an entry with no value, matching on the name alone` |
| C9 | Empty pattern table making the guard vacuously green | GUARD — asserted on the table | `is not empty — an empty table would make the guard silently vacuous` |
| C10 | Prose mentioning a rail flagged as a credential | GUARD | `does not flag prose that merely mentions a rail` |
| C11 | ReDoS on an adversarial value | OUT-OF-SCOPE | Every matcher is anchored or literal with no nested quantifier; input is this repository's own config, not user input. |

4. *Cross-check:* `cross-check: every reported violation is independently reproducible from the
   table` re-derives each violation from the pattern table by a second route, so a bug in the
   matching loop cannot produce a violation the table does not justify.

**C3 is the load-bearing one.** The realistic way NFR-2 dies is not an undetected credential; it is
a noisy detector that a developer deletes after it blocks them twice. `BANK_STATEMENT_BUCKET` and
`PAYMENT_DUE_DAY` are in the permitted list precisely because this product's domain vocabulary
overlaps the vocabulary of the rails it forbids.

#### Behavior D — the NFR-2 guard itself

Not a unit under test but the assertion the story exists to deliver. Its own failure mode is
**passing vacuously** — if `git ls-files` returned nothing and the environment were empty, an
`expect([]).toEqual([])` would be green while checking nothing. Guarded by a second test:
`actually inspected something, so a silent collection failure cannot pass as compliance`.

### Debug Log References

**Baseline (Step 2).** No test harness existed. Vitest 4.1.10 was installed per the epic pipeline's
standing approval for this stack. Baseline run: `No test files found, exiting with code 1` — harness
functional, zero tests, no pre-existing failures to exclude.

**Red (Step 6).** `npm test` → `Test Files 2 failed (2) | Tests 46 failed | 26 passed (72)`. Every
failure was an assertion failure against the stub implementations, not a missing-import error. The
26 that passed were the false-positive guards, which cannot go red against an empty pattern table —
their sensitivity was established separately below.

**Green (Step 7).** `Test Files 3 passed (3) | Tests 74 passed (74)`.

**Sensitivity check 1 — the guard bites.** `PLAID_SECRET=pretend npx vitest run
core/security/nfr2-guard.test.ts` → 1 failed, reporting
`process.env → PLAID_SECRET (matched on name, pattern "plaid")` with the reason text and **without
echoing the value**. Restored.

**Sensitivity check 2 — the false-positive guards bite.** A deliberately over-broad pattern
(`/KEY/i`) was added to the table; `core/security/forbidden-credentials.test.ts` → 7 failed | 46
passed. This is how the 26 negative tests were proven meaningful rather than vacuous. The table was
restored from a backup and re-verified at 74 passed.

**Final gate run.** `npm run lint` exit 0; `npm run build` succeeded (3 static routes); `npm test`
74 passed.

### Completion Notes List

**Deviations and decisions a reviewer should not have to rediscover:**

1. **ESLint pinned to 9.x, not 10.x.** The story specified `eslint@^10.8.0` on the strength of
   `eslint-config-next`'s declared peer range (`>=9.0.0`). That range is optimistic: under ESLint
   10, `eslint-plugin-react` (a transitive dependency of `eslint-config-next@16.2.12`) throws
   `TypeError: contextOrFilename.getFilename is not a function` while loading `react/display-name`,
   because ESLint 10 removed the legacy rule-context API the plugin still calls. Observed, not
   assumed. Pinned to `^9.39.5`. Revisit when `eslint-config-next` ships ESLint 10 support.

2. **TypeScript pinned to `~5.9.3` while npm `latest` is 7.0.2.** As specified in the story and for
   the reasons given there: the architecture spine binds "TypeScript 5.x", and
   `eslint-config-next@16.2.12` depends on `typescript-eslint@^8.46.0`, which targets the TS 5
   compiler API. Adopting TS 7 is a spine amendment and its own story, not a scaffold decision.

3. **No `pytest` job in CI.** Epic 1's overview says "both test harnesses in CI", but the epic's own
   recorded assumption #3 defers the Python agent service to Epic 2, and no Python code exists yet.
   A pytest job with nothing to run is scaffolding for its own sake. The harness and its CI job land
   with the first Python code. This is a decision, not an omission.

4. **`npm audit` reports 9 high-severity advisories, all upstream and none fixable here.** They are
   `postcss@8.4.31` (hard-pinned by `next@16.2.12` itself), `sharp@0.34.5` (an optional dependency
   of `next`), and `brace-expansion` reached through `eslint-config-next`'s plugin tree.
   `npm audit fix` finds no non-breaking remedy; `npm audit fix --force` proposes downgrading to
   `next@9.3.3`, which is absurd. Clearing them would require `overrides` that force versions past
   what the framework pins — a stack decision that deserves its own review rather than a silent line
   in a scaffold commit. Recorded here so it is visible rather than swallowed.

5. **`tsconfig.json` was rewritten by `next build`.** Next sets `jsx` to `react-jsx` and appends
   `.next/dev/types/**/*.ts` to `include` on first build. The committed file reflects that; it is
   Next's own mandatory reconfiguration, not drift.

6. **The Stripe-shaped test fixture is assembled at runtime, not written as a literal.** A
   processor-key-shaped string in a tracked file is exactly what GitHub push protection and secret
   scanners exist to stop, and being blocked by one would be the correct outcome. `processorKeyLike()`
   joins the parts at run time so the detector is still exercised honestly against the real shape.

7. **`renderEntriesAsText` lives in the test, not in production.** It exists only to satisfy the
   inverse-operation test; shipping it in `core/` would be production code that only the suite calls.

**Failure modes deliberately left out of scope:** ReDoS on adversarial values (C11) and
pathologically large config files (B12) — both justified in the Test Design table above.

**Sibling defect search (Step 8, question 4):** the codebase contains no other config-enumeration or
pattern-matching code — `core/security/` is the first non-scaffold module in the repository. Nothing
to report.

**Scope boundaries held:** no auth, no Supabase client, no design tokens, no database, no Python.
`app/page.tsx` is deliberately plain text; Story 1.3 owns the visual foundation.

### File List

- `.gitignore` (new)
- `.github/workflows/ci.yml` (new)
- `README.md` (new)
- `app/layout.tsx` (new)
- `app/page.tsx` (new)
- `core/security/config-entries.ts` (new)
- `core/security/config-entries.test.ts` (new)
- `core/security/forbidden-credentials.ts` (new)
- `core/security/forbidden-credentials.test.ts` (new)
- `core/security/nfr2-guard.test.ts` (new)
- `eslint.config.mjs` (new)
- `next.config.ts` (new)
- `package.json` (new)
- `package-lock.json` (new)
- `tsconfig.json` (new)
- `vitest.config.ts` (new)
- `_bmad-output/implementation-artifacts/1-1-project-scaffold-with-a-verified-build.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Local Code Review (AI) — 2026-07-30

Three adversarial layers ran against `9d0a695..4cd8858`: Blind Hunter, Edge Case Hunter, and an
Acceptance Auditor against this story and the architecture spine. They converged independently on
one theme, and it was the right one: **the guard's reach was materially narrower than this story and
the README claimed for it.** Every finding below was reproduced against the real modules before
being accepted, and every fix was driven by a test written first and observed failing.

**Fixed — reach (the guard could not see credentials that genuinely reach a deploy unit):**

- [x] **A git-ignored `.env` at the repository root passed the guard green.** The most likely way a
      credential ever enters this project was the one path the guard could not see: `git ls-files`
      cannot return an ignored file, yet `next build` and `next dev` load `.env` into the
      environment. The scan now walks `.env*` files **on disk**, ignored ones included, bounded by
      depth and an explicit skip list. Verified: `.env` holding `PLAID_SECRET` now fails the suite.
- [x] **A nested `.env` was invisible** — the `.env*` pathspec was root-anchored. The disk walk is
      recursive to depth 4. Verified with `infra/.env`.
- [x] **`vercel.json` was declared as a scan source that the parser was structurally incapable of
      reading.** Every JSON key begins with `"`, which the line parser can never match, so the
      pathspec entry created the appearance of coverage where there was none. Added
      `entriesFromJson`, which walks parsed JSON and reports every leaf under the key naming it, and
      throws rather than reporting a clean scan of a file it could not parse. Verified.
- [x] **`MISC_TOKEN: ${{ secrets.PLAID_SECRET }}` was undetected** — renaming the variable a secret
      is mapped onto defeated the check entirely, and this is the canonical way a deploy-unit secret
      appears in a tracked workflow. Added `secretReferencesFromText`, which reports the secret being
      *reached for* rather than the name it lands on. Verified.
- [x] **Every name pattern was `^`-anchored, so `PROD_PLAID_SECRET` and `NEXT_PUBLIC_PLAID_CLIENT_ID`
      escaped.** Stage prefixing is the ordinary multi-environment convention and this project
      already uses `NEXT_PUBLIC_*`, so adopting it would have silently disabled the detector. Vendor
      tokens now match at a name-segment boundary.
- [x] **YAML sequence items (`- PLAID_SECRET=abc`) were dropped** by the line parser — the shape
      docker-compose and action step files use.
- [x] **Lone-CR line endings collapsed a file to one unparseable line.**

**Fixed — the check could report compliance while inspecting nothing:**

- [x] **The anti-vacuity test could not detect the failure it was named for.** It asserted
      `collectConfigEntries().length > 0`, but `process.env` alone contributes 87 entries on this
      machine, so the file half could return zero and the test stayed green. It now asserts on the
      *files inspected*, and a third test asserts the CI workflow specifically is among them.
- [x] **The scan depended on `process.cwd()`.** `git ls-files` pathspecs and the subsequent
      `readFileSync` calls both resolved relative to the launch directory, so running from a
      subdirectory silently scanned nothing — which, before the fix above, read as compliance. The
      repository root is now resolved from `import.meta.url`.

**Fixed — false positives, the failure mode that gets a guard deleted:**

- [x] `PAYMENT_KEYS_ORDER` and `WIRE_TOKENIZED_DISPLAY` were flagged: `KEY` and `TOKEN` matched as
      bare prefixes of the following word. Added a `(?:_|$)` terminator.
- [x] `SQUARE_FOOTAGE_KEY` was flagged. Square footage is condominium vocabulary before Square is a
      payment processor — precisely the C3 shape. Square now requires a credential-shaped suffix and
      has its own pattern entry. Six near-miss domain terms are now in the permitted-name suite.
- [x] `stripMatchingQuotes` mangled `A="a" and "b"` into an unbalanced value; it now strips only
      genuinely wrapping quotes.

**Fixed — accuracy of claims:**

- [x] **`.gitignore` did not ignore `.env.production`, `.env.development` or `.env.test`,** all of
      which Next.js loads. Replaced with `.env` / `.env.*` / `!.env.example`. Verified with
      `git check-ignore` across all six variants.
- [x] **`actions/checkout@v5` and `actions/setup-node@v5` were two majors stale** — v7 is current
      for both (confirmed against the GitHub releases API). This story's own "Latest Technical
      Information" asserted v5 was current; corrected there too.
- [x] **The README overstated the check's reach.** It claimed "CI is where deploy-unit secrets are
      injected… so the check has real reach there", but this workflow maps no secrets into any step's
      environment, and GitHub does not inject them automatically. The README now states plainly that
      the workflow-file scan — not the environment scan — is what gives the check reach over the CI
      secret store, and that neither deploy unit's runtime environment is inspected.
- [x] **This story's Project Structure Notes omitted `config-entries.ts`,** contradicting its own
      File List. Corrected.
- [x] **`@types/react-dom` was pinned `^19.2.3` against a table saying `^19.2.17`** — that version
      does not exist (`ETARGET` on install); the `@types/react-dom` line lags `@types/react`. Table
      corrected rather than left as a silent deviation.
- [x] **Task 8's "confirm the CI run is green and record the run URL" was checked before any push
      had occurred,** so no CI run existed. Unchecked; it is completed after the epic branch is
      pushed and the run URL is recorded below.
- [x] **`concurrency.cancel-in-progress` cancelled push runs**, leaving an epic-branch commit with
      no verdict rather than a failing one. Now conditional on `pull_request`.

**Accepted, not fixed — with reasons:**

- **GitHub Actions secrets are not present in a step's environment unless a workflow maps them.**
  This is structural to GitHub, not a defect here. The mitigation is the `${{ secrets.* }}` scan: a
  secret that no tracked workflow references cannot be used by one. Stated explicitly in the README
  and the guard header rather than papered over.
- **Neither deploy unit's runtime environment is inspected.** A CI check cannot reach a Vercel or
  container-host runtime. NFR-2 binds "any deploy unit"; the check proves the property for the
  repository and the build, and now says so precisely instead of implying more.
- **Value matching covers only Stripe.** Stripe keys carry a distinctive `sk_live_`/`rk_test_`
  prefix; Plaid and QuickBooks secrets are undistinguished hex and cannot be matched by shape without
  false positives on every hash in the repository. The general mechanism for name-independent
  detection is the secret-reference scan, not value guessing.
- **The unfiltered `push` trigger double-runs same-repo PR branches.** Both triggers are wanted —
  push CI is the epic branch's integration gate, PR CI is the merge gate — and the duplication costs
  a runner minute rather than correctness.

Final state after review fixes: **106 tests passing**, `npm run lint` and `npm run build` clean.

### Change Log

| Date | Change |
| --- | --- |
| 2026-07-30 | Scaffolded Next.js 16.2.12 + TypeScript 5.9 + Vitest 4 with ESLint flat config; added the NFR-2 forbidden-credential detector and its CI guard test; added the CI workflow running lint, build and test on every push. |
| 2026-07-30 | Local adversarial review: widened the NFR-2 guard to see git-ignored and nested `.env` files, JSON config, and `${{ secrets.* }}` references; made detection survive name prefixing; removed false positives on condominium vocabulary; made the scan cwd-independent and genuinely non-vacuous; corrected `.gitignore`, action majors, and overstated claims in the README and this story. |
