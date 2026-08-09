---
baseline_commit: 7bfcb82
---

# Story 2.6: The documentation says what the code does, and ships a sample of every format

Status: review

> **Re-baselined twice.** First onto `3281477`, story 2.5's merge commit. Then onto `7bfcb82`,
> story 2.7's branch head, because 2.7 is not merged and its absence would repeat the same mistake
> one story later — 2.7 adds a document kind, so documentation written without it would ship a
> "sample of every format" that is missing one. **This story is therefore stacked on 2.7 and its
> merge request must wait for !30.**

## Why this story exists

Epic 2 is finished as code. It is not installable by anyone who was not in the room.

The README's Environment section instructs a reader to "fill in the two values from the Supabase
project's API settings" and to provision board members "in the Supabase dashboard". **Supabase was
removed from this project on 2026-07-31** and replaced by Railway Postgres, Auth.js and Cloudflare
R2. `.env.example` holds ten variable names, not two. `scripts/add-board-member.mjs` is how a
director is created. A person who follows the README today reaches a dead end on the first
instruction that has a consequence.

That is the smaller half. The larger half is that **nothing anywhere in this repository says what a
board member may put into the upload box.** The contract is real, it is precise, and it is
enforceable — `REQUIRED_HEADERS`, `AMOUNT_PATTERN`, `DOCUMENT_KINDS`, `MAX_DOCUMENT_BYTES` — and it
exists only as constants in five source files. A treasurer given this application has no way to
produce a file it will accept except by trial, and every rejection they earn is a sentence about
their document rather than an instruction about the format.

Epic 1 shipped the acceptance gate. Epic 2 shipped the ledger it feeds. Between them there is no
document that would let a stranger use either.

## What is actually wrong, verified

Each row below was checked against the working tree at `293c844`, not recalled.

| Claim, where it is made | What is true |
| --- | --- |
| `README.md` — "the two values from the Supabase project's API settings" | Supabase was dropped 2026-07-31. `.env.example` names ten variables in four groups: two Postgres URLs (AD-4's writer and reader), `AUTH_SECRET`, four R2 variables plus one optional, and two Gemini variables |
| `README.md` — "Board members are provisioned in the Supabase dashboard" | `scripts/add-board-member.mjs` |
| `README.md` — "The three gates" | Five commands. Story 2.5's gate is `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and `npx --no-install tsc --noEmit` against a baseline of 8 |
| `README.md` — "CI runs them on every push and on every pull request into `main` … a failing test fails the pipeline" | **There is no CI.** AD-2's amendment of 2026-08-07 withdrew it — GitLab bills per minute and the pipeline was removed. `origin` is GitLab; `.github/workflows/ci.yml` is a GitHub Actions file that has never run against this remote, so the README's Node-24 justification cites a file that does nothing |
| `README.md` — "The remaining directories … arrive with the stories that need them" | `adapters/` has four subdirectories, `migrations/` has 18 SQL files, `scripts/` has five entry points. None are mentioned |
| `README.md` — nothing about the database | A fresh clone that follows the README end to end has **no tables**. `npm run migrate` is undocumented |
| `README.md` — nothing about uploading | The subject of this story |
| `architecture-walkthrough.html` lines 274, 552 — "Fifteen decisions", "Fifteen invariants" | Sixteen. AD-16 (bytes in object storage, database holds identity only) was added 2026-07-31 |
| `security-posture.html` line 303 — evidence: "CI check asserting no matching key names" | The check exists and still runs; **CI does not**. It is now a local habit, which AD-2's amendment says plainly and this page does not |
| `security-posture.html` line 357 — evidence: "CI diff check on published catalog versions" | Same withdrawal, and the catalog does not exist yet either — that is Epic 3 |

## The thing a reader most needs told, and nowhere is

**Units are not created by upload.** `unit`, `unit_holder`, `unit_membership` and `assessment` have
no ingestion path and no admin surface — verified by search: outside migrations, the only statements
inserting into them are in `*.test.ts` files. `assessment_roll` is an accepted `documentKind`, but
all it does is store extraction rows; it creates no unit and no assessment.

The consequence lands exactly where a new installer will meet it. Upload the deposit sample to a
fresh install and **every line is held with reason `unknown-unit`**, because there are no units for
a reference to resolve against. The system is working correctly and looks broken. A README that
ships a deposit sample without saying this has shipped a trap.

## Story

As someone installing this application,
I want documentation that matches the code and a sample of every format it accepts,
So that I can get from a clone to a document the system has actually read, without reading source.

## Acceptance Criteria

**AC1**
**Given** a clean clone and the README alone
**When** a reader follows it from the top
**Then** they reach a running application with a migrated database and a signed-in board member, and
every instruction on the way is true of the code at HEAD — no step requires opening a source file,
and no step names a vendor this project does not use

**AC2**
**Given** the six content types `core/ingestion/acceptance.ts` accepts — PDF, PNG, JPG, CSV, `.xls`,
`.xlsx`
**When** the README is read
**Then** there is a committed sample file for each, and the README states for each one what it
contains, what the system does with it, and what appears afterwards

**AC3**
**Given** a change to the upload contract — a required header, the amount pattern, the size limit,
the document kinds
**When** the gate runs
**Then** a test fails, naming the sample and the document that now disagree with the code. The
samples and the prose cannot drift silently, because drift is the entire failure mode of this story

**AC4**
**Given** the system diagram
**When** it is read
**Then** it shows the path as built — the acceptance gate, the split between the deterministic
tabular path and the provider path, the vendor hold, and the payment/held-payment write — and
nothing that is only planned appears without being marked as such

**AC5**
**Given** the three planning artifacts — the board explainer, the walkthrough deck, the security
posture
**When** a claim in one of them is no longer true
**Then** it is amended in place with a dated note saying what changed and why, in the manner AD-2's
own amendment uses. **Withdrawn claims are not deleted.** A control register that quietly loses a
row reads as a register that never had it

## Tasks / Subtasks

- [x] **Task 1 — State the upload contract, from the code rather than from memory** (AC1, AC2, AC3)
  - [x] Write the contract down once: required and optional headers, the accepted `type` values, the
        date and amount shapes, the per-file and per-batch limits, and what one bad row costs. The
        table in Dev Notes below is a starting draft and **must be re-derived from the source**, not
        copied — it was assembled by reading, and reading is exactly what this story exists to spare
        the next person.
  - [x] Every number and every list in it is already a constant. Cite the constant beside the value
        so a later reader knows where the truth lives: `REQUIRED_HEADERS`, `OPTIONAL_HEADERS`,
        `DOCUMENT_KINDS`, `AMOUNT_PATTERN`, `MAX_DOCUMENT_BYTES`, `MAX_UPLOAD_BATCH_BYTES`,
        `MAX_FILES_PER_UPLOAD`, `MAX_WORKBOOK_CELLS`, `HOLD_REASONS`.
  - [x] Say what happens when a file is refused, in the words the surface actually uses. The four
        `REJECTION_REASONS` and the tabular `TABULAR_PROBLEMS` are different sets with different
        remedies — "unreadable" from the gate means the container lied about its type; "unreadable"
        from the tabular reader means the columns were wrong.

- [x] **Task 2 — A sample for every accepted format** (AC2, AC3)
  - [x] One file per content type, six in all, under `samples/`. Each must pass `assess()` and then
        do the thing the README says it does.
  - [x] **Generated from one source of truth, not six hand-authored files.**
        `scripts/build-samples.mjs` holds the rows once and writes the CSV, the `.xlsx`, the `.xls`
        and the PDF from them. Six files hand-maintained against one contract is six chances for the
        README to be right about five of them.
  - [x] **The two rasters are the exception, and say so.** PNG and JPG carry figures a model reads,
        which means they must be real images of a real document. Committing them and having the
        script *verify* rather than regenerate them is the recommended shape — the alternative is a
        rasterising devDependency, which is a defensible call but a new dependency in a repo that has
        avoided one for the PDF path. Whichever is chosen, the README states which samples are
        generated and which are fixed, because a reader who edits a fixed one and re-runs the script
        will otherwise think it silently ignored them.
  - [x] **Verify the `.xls` signature rather than trusting the writer.** `assess()` requires the OLE
        compound header `D0 CF 11 E0 A1 B1 1A E1`, and SheetJS's `xls` book type does not
        unconditionally produce BIFF8. A sample that fails the gate it exists to demonstrate is the
        worst possible sample.
  - [x] Cover the kinds, not just the containers: a deposit bank feed with a `unit` column, an
        invoice batch, and a statement with no `type` column at all — which is the default and the
        one most likely to surprise.
  - [x] **Add `.gitattributes`** marking the sample binaries `binary`. Without it a CRLF
        renormalisation corrupts every one of them, and the open epic-1 action item
        ("Add .gitattributes and renormalise the repo-wide CRLF") means someone intends to run
        exactly that. Scope it to the samples here; the repo-wide renormalisation stays that item's
        work.

- [x] **Task 3 — The README a stranger can follow** (AC1)
  - [x] Correct every row of the defect table above. The Supabase paragraphs are replaced, not
        patched: they name a vendor with no presence in this repository.
  - [x] Add the missing path to a running system: `npm run migrate`, then
        `scripts/add-board-member.mjs`, then `npm run dev`. A reader who never runs the migration has
        an application whose every upload fails on a foreign key.
  - [x] Correct the gate. Five commands, and **say that none of them run automatically** — AD-2's
        amendment is explicit that a local run is not a gate, and a README claiming a pipeline that
        does not exist is the single most misleading sentence in the file.
  - [x] Add the upload section: the contract from Task 1, the samples from Task 2, and the
        `unknown-unit` warning above, stated where a reader meets it rather than in a footnote.
  - [x] Say what to do about it. Whether that is a documented `insert into unit` for the pilot or a
        seed script is a call for the dev — but the sample deposit must be *usable*, and today it
        resolves nothing. If a seed lands, it is the smallest thing that makes the sample work, not
        a units admin surface; that is a story of its own.
  - [x] Correct the Layout section against the real tree.

- [x] **Task 4 — The as-built system diagram** (AC4)
  - [x] A diagram in the README itself, so a reader gets the shape without leaving the file. Mermaid
        renders on GitLab, which is where this repository lives.
  - [x] A standalone page for the longer form, in the house style the three planning artifacts
        share. `docs/` is its home rather than `_bmad-output/planning-artifacts/`: this one describes
        what was built, and filing it with the planning set is how it comes to be read as a plan.
  - [x] It must show the fork that governs everything: CSV and Excel are parsed in `core/` at upload
        time and **never reach a provider**; PDF, PNG and JPG are stored and read later on a polled
        request. That single split explains most of the system's behaviour and is invisible in every
        current artifact.
  - [x] Mark Epic 3 and Epic 4 components as not built. The walkthrough deck describes the Oracle and
        the Watchdog in the present tense; neither exists.

- [x] **Task 5 — Amend the three planning artifacts** (AC5)
  - [x] `architecture-walkthrough.html`: the invariant count, twice. Present-tense claims about the
        Oracle, the agent service and the anomaly detector become clearly-marked plans.
  - [x] `security-posture.html`: the two CI evidence rows. The control is unchanged; its *evidence*
        was withdrawn on 2026-08-07 and this page still asserts it. A security document asserting a
        control that nothing enforces is the one kind of staleness with a real consequence.
  - [x] `board-explainer.html`: check before editing. Its subject is the air-gap, which is intact, so
        it may need little. If it needs little, say so in the completion notes rather than editing it
        to show work.
  - [x] Amend in place with dated notes. AD-2's own amendment is the model: it states the rule is
        unchanged, states plainly what got weaker, and says a later reader should find a decision
        rather than an erosion.

## Dev Notes

### The contract as it stands — a draft to re-derive, not to copy

Assembled by reading `acceptance.ts`, `tabular.ts`, `validate.ts`, `record.ts` and
`workbook-sheetjs.ts`. Task 1 re-derives it; a transcription error here becomes a wrong README.

| | |
| --- | --- |
| Accepted types | `application/pdf`, `image/png`, `image/jpeg`, `text/csv`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Per file | 25 MiB, and non-empty |
| Per submission | 50 MiB, 20 files |
| Required headers | `date`, `description`, `amount` — matched after trim and case-fold |
| Optional headers | `reference`, `type`, `unit` |
| `type` values | `invoice`, `statement`, `assessment_roll`, `deposit`, `other`. Absent means `statement` |
| `unit` | Read **only** when the row's `type` is `deposit`. Ignored, not refused, on every other kind |
| `reference` | The transaction reference. Lands in `documentNumber`, and is deliberately *not* a second way to say `unit` |
| `date` | `YYYY-MM-DD`, and a real calendar day |
| `amount` | `^-?\d{1,12}(\.\d{1,2})?$`. No currency symbol, no thousands separator, at most two decimals |
| Currency | Always `USD` |
| One bad row | Fails the whole document. Nothing partial is stored |
| Also refused | Duplicate headers, ragged rows, a header row with no data rows |
| Excel | First sheet only; cell *values*, not their display format; at most 500,000 cells |
| PDF | Refused before parsing if the trailer announces `/Encrypt` |
| CSV | Refused if a NUL appears in the first 8 KiB — the only structural tell text has |

### Where a document goes, and it is not one path

- **CSV, `.xls`, `.xlsx`** — parsed by `core/extraction/tabular.ts` during the upload request. No
  provider is reachable from that module by construction, and a test asserts the extractor is never
  called for these types. Results exist by the time the response renders.
- **PDF, PNG, JPG** — stored, then read on a later polled request through
  `adapters/extraction/extractor-gemini.ts`. Needs `GEMINI_API_KEY` and `GEMINI_OCR_MODEL`. Without
  them the document is held, unread, and nothing is lost — which is a state the README must
  describe, because it is what an installer who skipped the Gemini variables will see.

A deposit becomes payments in **both** paths — that is story 2.5, and
`core/ingestion/record-payments.ts` is the one module both call.

### Hold reasons a treasurer will actually meet

`unknown-unit`, `missing-reference`, `missing-amount`, `missing-date`, `unsupported-amount`. On a
fresh install every deposit line earns the first. See above.

### Learnings that apply directly

This is a documentation story, and its failure modes are its own rather than epic 2's:

1. **A sample that is never uploaded is a sample that does not work.** The lesson from story 2.5 —
   green parts, no working path — transposes exactly. A test that only asserts the file exists is
   this story's version of the defect it was written about.
2. **Prose cannot be pinned by review.** AC3 exists because the only durable check on a README is a
   test that reads the same constant the prose quotes. Quote the constants in a form a test can
   compare.
3. **Do not document the plan.** The instinct on reaching an unbuilt component is to describe it. The
   walkthrough deck already did that in the present tense, which is half of why it now misleads.
4. **Check before editing the board explainer.** Editing a document to show effort is how a correct
   document becomes a wrong one.

### Testing standards

- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and
  `npx --no-install tsc --noEmit` against its **baseline of 8**. Quote the numbers from the run, not
  from memory.
- The sample test needs no database. `assess`, `readTable` and `readWorkbook` are pure, so the whole
  of AC3 is provable in `npm test` against committed bytes — no `RUN_PREFIX`, no Railway.
- `npm test` collects `**/*.test.{ts,tsx}` outside the excluded roots, so a test file under
  `samples/` is collected without a config change. Read the file count in the summary and confirm it
  moved.
- `core/security/nfr2-guard.test.ts` reads tracked config for credential shapes. Sample files hold
  fictional vendor names and amounts and should not trip it — confirm rather than assume, since this
  story adds tracked files for the first time in a while.

### References

- `core/ingestion/acceptance.ts` — the gate, and the reason each format is refused.
- `core/extraction/tabular.ts` — the header contract, and the note on why `unit` is its own column.
- `core/ingestion/record-payments.ts` — the one module both ingestion paths call.
- `ARCHITECTURE-SPINE.md`, AD-2's amendment of 2026-08-07 — the model for how AC5's amendments read.
- `_bmad-output/implementation-artifacts/2-5-deposits-become-payments-on-upload.md` — the
  predecessor, and the source of the "green parts, no working path" lesson AC3 is built on.

## Dev Agent Record

### Agent Model Used

### Test Design

**The story's central warning is obsolete, and story 2.7 is why.**

Under *"The thing a reader most needs told"* this story states that `unit`, `unit_holder`,
`unit_membership` and `assessment` have no ingestion path, that `assessment_roll` "creates no unit
and no assessment", and that uploading the deposit sample to a fresh install holds every line with
`unknown-unit`. Verified against this baseline: **all of that is now false.** `core/ingestion/record-roll.ts`
is documented as "a read assessment roll becomes units, holders, tenures and assessments", and
`adapters/db/roll-repository-postgres.ts` inserts into all four tables.

The prose is left as written rather than edited, because a story's premise is not mine to rewrite;
the correction is recorded here and carried into the work:

1. **The `unknown-unit` trap becomes an ordering instruction, not a warning.** Upload the roll
   sample first, then the deposit sample resolves against real units. That is a better README than
   the warning it replaces.
2. **Task 3's open question is answered by the product.** It asks whether a documented
   `insert into unit` or a seed script is the fix; neither. The roll upload is the fix, and it is
   the path a real association would use.
3. **Task 2's kind coverage gains one.** "A deposit bank feed, an invoice batch, and a statement
   with no `type` column" becomes four — the assessment roll is the kind that makes the others
   usable, so it is the first sample a reader should use, not the last.
4. **Task 1's contract table gains the roll's headers.** `ROLL_HEADERS` is `['cycle', 'year']`,
   alongside `REQUIRED_HEADERS` and `OPTIONAL_HEADERS`. A contract derived from the source before
   2.7 merged would have been wrong on the day it was written.

**AC2 is unaffected: still six content types.** A roll is a `documentKind`, not a container —
`acceptance.ts` is untouched by 2.7. Worth stating because "add a format" and "add a kind" look
alike and only one of them changes AC2.


### Debug Log References

**A transient failure in one full run, unexplained, recorded rather than buried.** During task 2 one
`npm test` reported `dual-llm-boundary.test.ts` failing two clauses, including *"scans a non-empty
set of source files"*. The file passes alone (23/23), passes beside `samples.test.ts` (44/44), and
five subsequent full runs are identical at 1633. My first suspicion was the samples control, which
rewrites `samples/deposits.csv` while other suites walk the tree — but that scan reads only `.ts`,
`.tsx`, `.mjs` and `.js`, so a `.csv` write cannot reach it. No attribution, so no claim of a fix.


**Worktree baseline, `c:/tmp/hoa-story-2-6` on `7bfcb82`.** Unit suite 97 files / 1580 passed.

**A fresh worktree silently skips the database suite.** `npm run test:db` reads `.env.local`, which
is gitignored and therefore absent from a new worktree — the first run here reported *green* with
**17 files and 450 tests skipped**. Copied the file in (still ignored, verified with
`git check-ignore`), after which the suite is 35 files / 573 passed with nothing skipped.

Worth recording because it is this project's recurring failure shape in a new place: a suite that
does not run looks exactly like a suite that passed, and the only tell was reading the skip count.


### Review Findings

**Local round — Argus, then the CodeRabbit CLI.** The skill's step 4b was rewritten for the CLI in
story 2.7, so this is the first story to use it here.

*Two obstacles, both worked around rather than skipped.* WSL cannot read a linked worktree — its
`.git` is a file pointing at a Windows path — so the review ran against a throwaway clone at
`c:/tmp/cr-2-6` checked out at the pushed head, verified from inside WSL as the same HEAD, base and
21-file diff. The main checkout was on another branch's close-out and was left alone.

**`argus_ingest` cannot read the CLI's output, and the skill's step 5 has therefore never worked.**
Passing `from: .argus/cr.jsonl` with the commit returns `reviews_found: 0`. Not a path problem:
tested against story **2.7's own capture and commit** in the main checkout — also zero — while
auto-discovery against the VS Code extension's storage finds 8. The adapter parses the extension's
JSON, not the CLI's JSONL. So the step reads as done and learns nothing, which is this project's
recurring failure shape sitting inside its own review tooling. Recorded here; fixing the adapter is
not this story's work.

*CodeRabbit: `review_completed`, 21 of 21 changed paths reviewed, 4 findings. Argus: 4.* Three fixed,
one declined.

**[major, CodeRabbit] The CI-citation guard counted instead of associating.** It asserted two
citations and two amendments existed *somewhere* in the file — which passes if one row carries both
notes and another carries none. An aggregate count is not an association. Now each citation is
checked against its own row.

**[high, Argus] The drift control mutated the tracked fixture.** It corrupted `samples/deposits.csv`
and restored it, which loops a watcher and leaves a dirty tree if the run aborts. It was already my
leading suspect for the task-2 transient. Now it copies the script and samples into `.probe/`
(gitignored, inside the repo so `xlsx` still resolves) and corrupts the copy.

**[minor, CodeRabbit] `assessment-roll.csv` was never assessed.** The `SAMPLES` list was one entry
per content type because the coverage assertion compared sorted lists — so *the assertion shaped the
fixture*, and the fixture quietly excluded the second CSV. That CSV is the sample a new installer
uploads first. Coverage is a set comparison now, and a new test asserts every committed file appears
in the list.

**[minor, CodeRabbit] Declined, verified first: the diagram's vendor branch.** It asked that only
invoices route through vendor validation. `holdUnknownVendors` does not filter by kind at all — every
record with a non-null vendor name goes through it, deposits and statements included. The diagram is
right and the suggestion would have made it wrong.

*Sensitivity check — five mutations:*

| Mutation | Result |
| --- | --- |
| drop the roll from `SAMPLES` | 1 of 22 failed |
| make the drift script always exit 0 | 1 of 24 failed |
| a CI citation without its withdrawal | 1 of 7 failed |
| a new top-level directory the README omits | 1 of 13 failed |
| delete the `npm test` line (earlier round) | 1 of 13 failed |

**A mistake of my own, worth recording.** Restoring a mutated file with `git checkout --` discarded
four *uncommitted* fixes in it, and the next run passed — so the loss looked like success. Mutations
must be restored from a copy, never from git, on a file with uncommitted work.


**Rebased onto `main` once story 2.7 merged (`fe86f5f`).** The branch was cut from 2.7's head so a
"sample of every format" would not ship one short; with 2.7 in `main` the diff is 21 files, all this
story's own. Gates re-run on the new base.

**Argus, on the rebased head — one finding, and it is this story's own failure mode.**

**[medium] The README gate assertion passed vacuously.** It looped over the npm scripts asserting
`readme.toContain(\`npm run ${script}\`)`, with a `.replace('npm run test
', 'npm test')` that never
matched because the template has no newline. So for the `test` script it asserted `npm run test` —
which is a **prefix of `npm run test:db`**, already in the file. Confirmed rather than assumed:
deleting the `npm test` line from the README left all thirteen green.

A documentation guard that cannot notice a missing gate command, in the story whose entire subject is
documentation drift. Now matched line-anchored against an explicit command map, because `toContain`
on a command that prefixes another command is a coincidence rather than a check.

| Mutation | Result |
| --- | --- |
| delete the `npm test` line | 1 of 13 failed *(passed before the fix)* |
| delete the `tsc --noEmit` line | 1 of 13 failed |


### Completion Notes List

**Task 4 — the diagram.** A Mermaid flowchart in the README so a reader gets the shape without
leaving the file, and `docs/as-built.md` for the longer form. Both lead with the fork that governs
everything: **CSV and Excel are parsed in `core/` at upload time and never reach a provider; PDF,
PNG and JPG are stored and read later.** That split explains most of the system's behaviour — cost,
latency, and what can go wrong — and it appears in no planning artifact.

Epic 3 and epic 4 components are drawn dashed and labelled **NOT BUILT**. `docs/as-built.md` filed
under `docs/` rather than with the planning set, because filing a description of what was built
alongside the plans is how it comes to be read as one.

**Task 5 — the amendments.** All three artifacts checked; two amended, one deliberately not.

*The walkthrough said "Fifteen" twice; the spine declares sixteen.* AD-15 and AD-16 were added
2026-07-31. Corrected with a dated note, and the deck gained a banner naming what is built, what is
not, and what was withdrawn — one banner rather than five scattered edits, since the deck is
present-tense throughout.

*The security posture's two CI evidence rows are amended in place, not deleted.* The controls are
unchanged and still hold; their **evidence** was withdrawn on 2026-08-07. The second row carries two
withdrawals rather than one: the pipeline is gone *and* the published catalogue it would diff does
not exist yet.

*The board explainer was checked and needed nothing,* which the story asked to be said rather than
worked around. Its subject is the air-gap — that this system cannot move money — and that claim is
intact and enforced by `nfr2-guard.test.ts`. Editing it to show work would have been the wrong
instinct.

*`docs/planning-artifacts.test.ts` guards the clause that most needed it:* withdrawn claims are not
deleted. Each assertion checks the amendment **and** the original claim beside it — either alone
would pass for the wrong document. The decision count is derived from the spine rather than
transcribed, so a seventeenth decision fails the deck.

| Mutation | Result |
| --- | --- |
| delete a withdrawn row | 1 of 7 failed |
| drop an amendment note | 1 of 7 failed |
| add a 17th decision to the spine | 1 of 7 failed |

**Task 3 — the README, and a guard on it.** Every row of the defect table is corrected. Supabase is
gone entirely rather than patched: it named a vendor with no presence in this repository.

*The missing path to a running system is now the Getting Started block* — install, env, **migrate**,
`add-board-member.mjs`, dev. A clone that stopped after `npm run dev` had an application whose every
upload failed on a missing table, and nothing said so.

*Task 3's open question is answered by story 2.7 rather than by a seed script.* "What to upload
first" tells a reader to upload `samples/assessment-roll.csv` before anything else, because
uploading a roll is the only way units come to exist. The deposit sample then resolves. A seed
script would have been a worse answer: it is not the path a real association would use.

*`docs/readme.test.ts` guards the countable claims*, because none of the original defects needed
carelessness — they needed only time. It checks the environment variables in both directions, the
gate commands, the migration count, every top-level directory, every sample named in both
directions, that the file says plainly nothing runs automatically, and that the word "Supabase"
never returns.

*Sensitivity check — three mutations:*

| Mutation | Result |
| --- | --- |
| mention Supabase again | 1 of 13 failed |
| drop a sample from the table | 1 of 13 failed |
| add a migration file | 1 of 13 failed |

The third is the one that matters: it is drift with **nobody editing the README at all**, which is
how every defect in the story's table arrived.

**Task 2 — six samples, four generated and two verified.**

*One source of truth.* `scripts/build-samples.mjs` holds the rows once and writes the CSV pair, the
`.xlsx`, the `.xls` and the PDF. `--check` compares byte for byte, and `samples/samples.test.ts`
runs it, so editing a sample by hand or editing the rows without rebuilding fails the gate.

*The PDF is hand-built.* This repository has no PDF dependency and a sample is not a reason to
acquire one — catalog, pages, page, Helvetica, one content stream, with the cross-reference offsets
computed from the assembled bytes so editing the text cannot silently produce a broken file.

*The two rasters are committed, not generated,* which is the shape the story recommended. They were
authored once by rendering an SVG through `sharp` — which is present only as a transitive dependency
of Next, so the script deliberately **verifies** them rather than depending on it. Stated in the
script and in the README, because a reader who edits one and re-runs the script would otherwise think
it was ignored.

*The `.xls` signature is checked, not trusted.* SheetJS's `biff8` output does begin
`D0 CF 11 E0 A1 B1 1A E1`, and a second assertion proves it is **not** a ZIP — asserting only the OLE
header would pass for an encrypted `.xlsx`, which is also an OLE compound file and is exactly why
`acceptance.ts` keeps the two signatures apart.

*The samples exercise the contract rather than illustrating it.* The roll carries all three billing
cycles; the deposits carry a reference the roll spells differently and one unit the roll does not
have, so a reader sees a held line on purpose; the statement has no `type` column at all and carries
a negative amount.

*A finding the samples produced:* `4b ` in the file reads back as `4b`, because `validate` trims
every text field before it becomes a record. A trailing space cannot reach the ledger, so a sample
cannot demonstrate one. The test asserts what the system does rather than what the file says, and
`upload-contract.md` gained a line stating that cell values are trimmed.

*The control corrupts a real sample and restores it* rather than asking the script for a sabotage
flag: production code gains nothing to make itself testable, and a `--check` that exited 0
unconditionally would make the drift assertion pass forever.

*`.gitattributes` is scoped to `samples/`.* An open action item intends a repo-wide CRLF
renormalisation, and that pass would rewrite line endings inside these fixtures — changing the
`.xls` signature bytes and the PNG's deflate stream. The CSVs are marked `-text` because their CRLF
endings are RFC 4180's and the byte comparison depends on them.

*Two guards fired and were widened deliberately:* `tsconfig-coverage.test.ts` caught `docs/` and then
`samples/` sitting outside tsconfig's `include`, so neither new test was being type-checked.

**Task 1 — the contract, and the guard that keeps it true.** `docs/upload-contract.md` states it
once; `docs/upload-contract.test.ts` derives every value from the constants and fails when the two
disagree. The story insisted the draft table be re-derived rather than copied, and it was right
twice over.

*The re-derivation caught its own first attempt.* `BILLING_CYCLES` is three values, not two —
`six_monthly` sits between them. The draft said two because the value had been read with a grep whose
character class excluded the underscore, and the same omission would have made `six_monthly`
invisible to the stray check meant to catch it. The test failed on it before the page shipped.

*The guard was, at first, a guard that proved nothing.* Version one took a regex describing the
family and reported document tokens matching it that were not members — but every call site built
that regex from the member list itself, so the stray set was empty by construction. An invented
`receipt` kind passed. A control test covered the mechanism and every real call was shaped so it
could never fire; the control passed for a case no caller exercised. Rebuilt to read the document's
own tables, so "listed but not in the code" is answerable at all.

*Its first row filter silently emptied a table.* It skipped rows whose first cell began with a
capital, meaning to skip a header, and dropped every row of the Formats table — whose codes are PDF,
PNG and JPG. Now it slices after the `| --- |` separator, and `statesExactly` refuses a table with
no rows.

*Sensitivity check — three mutations:*

| Mutation | Result |
| --- | --- |
| invent a `receipt` kind on the page | 2 of 20 failed *(passed before the rebuild)* |
| drop `missing-date` from the hold reasons | 1 of 20 failed |
| change `VENDOR_NAME_MAX_LENGTH` in the code | 1 of 20 failed |

The third matters most: the page is guarded against drift from **both** sides, so a constant moving
under it fails as loudly as a sentence edited over it.

*`tsconfig-coverage.test.ts` earned its place.* `docs/` was outside tsconfig's `include`, so the new
test was not being type-checked at all and `tsc` stayed at 8 while an untyped file sat in the tree.
Added `docs/**/*.ts`. A new source directory is a new hole in the gate unless something says so.


### File List

- `docs/upload-contract.md` — added, Task 1.
- `docs/upload-contract.test.ts` — added, Task 1.
- `tsconfig.json` — modified, Tasks 1 and 2.
- `scripts/build-samples.mjs` — added, Task 2.
- `samples/samples.test.ts` — added, Task 2.
- `samples/assessment-roll.csv`, `samples/deposits.csv`, `samples/invoices.xlsx`,
  `samples/statement.xls`, `samples/deposit-slip.pdf` — added, Task 2 (generated).
- `samples/deposit-slip.png`, `samples/deposit-slip.jpg` — added, Task 2 (committed, verified).
- `.gitattributes` — added, Task 2.
- `README.md` — rewritten, Task 3.
- `docs/readme.test.ts` — added, Task 3.
- `docs/as-built.md` — added, Task 4.
- `README.md` — diagram added, Task 4.
- `_bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29/architecture-walkthrough.html` — amended, Task 5.
- `_bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29/security-posture.html` — amended, Task 5.
- `docs/planning-artifacts.test.ts` — added, Task 5.

### Change Log

- 2026-08-09 — All five tasks complete. Status -> review.
- 2026-08-08 — Story created, to close epic 2 with documentation that matches the code. Ten
  documentation defects verified against the working tree rather than recalled, the largest being a
  README Environment section naming a vendor removed on 2026-07-31 and a CI pipeline withdrawn on
  2026-08-07. Status -> ready-for-dev.
