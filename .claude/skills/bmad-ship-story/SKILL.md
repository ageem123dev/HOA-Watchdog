---
name: bmad-ship-story
description: 'Run a single story end-to-end on its own branch: create it, implement it test-first, review it locally with Argus and open-code-review, open a merge request to main, and stop at ready-to-merge. Use when the user says "ship a story", "ship the next story", "run the story pipeline", or "ship story <id>". Reviews are local and synchronous, so one run goes end to end; called in a loop by bmad-implement-epic.'
---

# Ship Story Pipeline

Take one story to a green, reviewed, ready-to-merge MR. **One story = one branch = one MR = one review cycle** — story-sized diffs are the largest a reviewer can hold in their head.

Resumable: every run detects state from `sprint-status.yaml`, git and the MR, then advances. Safe to re-run.

## Conventions

- `implementation_artifacts` = `_bmad-output/implementation-artifacts`; `sprint_status` = that + `/sprint-status.yaml`; `story_file` = that + `/{story_key}.md`.
- **GitLab only.** `glab` for all remote ops; MRs not PRs.
- **CI:** `{ci}`. Where there is none, the local gate is the only evidence a head is green — say "gates green locally on `<sha>`", never "pipeline green".
- Project path `{project}`, encoded `{project_encoded}` for `glab api`.
- Never guess MR state — query it.

## Hard rules

- **Never merge, never push to `main`.** Terminal state is ready-to-merge.
- **Never commit secrets.** `.env*.local` stay gitignored; never `git add -f`.
- **Never weaken, skip, or delete a test** to get a green suite or a clean review. Fix the code or STOP with the conflict stated. **This matters more now than it did**: with no CI, the local gate is the only thing between a broken suite and `main`.
- **Never mark a story `done` on unverified work** — all tasks checked, lint+build+test clean **on the final head**, no open actionable feedback. Nothing enforces this externally, so re-run the gates after the close-out commit rather than trusting the run from before it.
- Only edit the story file in: Status, Tasks checkboxes, Dev Agent Record (Debug Log / Test Design / Completion Notes), **Review Findings**, File List, Change Log, and frontmatter `baseline_commit` + `merge_request`.
- Quote real output. If a step fails, surface it and stop.

## Workflow

**Input:** optional story id (`1.5`, `1-5`, `1-5-slug`) or file path.

### 0 — Preflight

`glab auth status` and `git` available. If `glab` is missing from PATH: `export PATH="$PATH:{glab_path}"`. Read `sprint_status` fully — order matters.

### 1 — Resolve the story

With an argument, match the `N-M-*` key. Without one, take the first non-`done` story key that is not an `epic-*`/`*-retrospective`. All done → report and STOP.

### 2 — Branch

1. `git checkout main && git pull --ff-only origin main`, then `git fetch origin`. **Name the remote** — a bare `git pull` follows the branch's configured upstream and a wrong one fails *silently by succeeding* ("Already up to date" while behind). That has happened here. The separate fetch matters too: `pull origin main` updates only `origin/main`, so without it a remote story branch is invisible locally and step 3 misclassifies it as absent.

2. **Predecessor gate — before selecting or creating any branch.** If `main` lacks the previous story's work, branching now bases this story on the wrong commit, and a later resume reuses that branch and ships the predecessor's diff inside this MR. Diagnose the two causes separately:
   - GitLab says its MR is **not merged** → it awaits the user. STOP and name the MR. See *Stacking*.
   - GitLab says **merged** but the commit is unreachable → your local `main` is wrong, not the MR. Fetch and re-check the upstream; do not report it as awaiting a merge.

3. Select the branch — `git checkout -b` fails outright on an existing branch, which would break resumability on the second run:
   - local branch exists → `git checkout story/{story_key}`
   - only the remote exists → `git checkout -b story/{story_key} --track origin/story/{story_key}`
   - neither → `git checkout -b story/{story_key}`

4. **On either existing-branch path, require `origin/main` to be an ancestor** (`git merge-base --is-ancestor origin/main story/{story_key}`). A branch cut before the predecessor merged is stale, and its MR would carry work that is not this story's. If it is not an ancestor, rebase onto `origin/main`; STOP on conflicts rather than resolving them here.

### 3 — Create (if needed)

Status `backlog` or no story file → invoke **`bmad-create-story`**. Otherwise skip.

### 4 — Implement test-first (if needed)

Status `ready-for-dev`/`in-progress` → invoke **`bmad-dev-tdd`** (failure-mode analysis → red → green → harden; fills the Dev Agent Record; sets status `review`). Already `review`/`done` → skip.

- **Harness (its Step 2):** if none exists for the story's language, approve the conventional one rather than stalling — **Vitest** (TS), **pytest** (Python). STOP only for a heavyweight runtime change the story doesn't cover.
- **A story adding a gate must add it to the local gate** — a `package.json` script *and* the "Tested =" line under *Project facts*, so the next run inherits it. There is no CI to add it to. A gate nobody knows to run is not a gate.
- Pass `story_path` explicitly so its discovery menu never fires under `/loop`.
- Run `python3 _bmad/scripts/resolve_customization.py` as its Steps 1 and 11 instruct; hand-merge TOML only if it errors.
- **A HALT is a real halt** — ambiguous AC, untestable design, test/code conflict. Surface and STOP.

Then commit (trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`) and `git push -u origin story/{story_key}`.

### 4b — Local review, before the MR exists

**The reviewer is local and synchronous.** Nothing reviews the MR, so every review this change gets, it gets here. Rounds are no longer scarce — `ocr` has no rate limit, only cost (~0.9–2.1M tokens a run) — so iterate until a round comes back clean.

**One base for the whole step: local `main`, fast-forwarded at step 2.** Argus, `ocr` and the diff checks all use it; mixing in `origin/main` means they score different diffs the moment anyone merges upstream mid-round.

1. **`argus_review` first** (`git_range: main...HEAD`). Fix test-first, run 8a's gate on the fix diff, and commit. `ocr` reads tests too once coverage is configured (below), but it is **measurably weak on them** — so this is not a warm-up for `ocr`.

2. **`ocr`, with the story as its background. The background file is not optional:**

   ```bash
   ocr review --from main --to HEAD --audience agent -f json \
     -B {story_file} --max-tokens-budget 250000 > .argus/ocr.json 2> .argus/ocr.err
   ```

   Measured on commit `3450d7d`, the same six files both ways: given the ACs it found a real defect — a reviewed finding could still be emailed — and rated it critical. Blind, it missed that entirely and returned eleven generic nitpicks (missing error handling, missing JSDoc, a magic number). **A run without `-B` has reviewed the code's form, not the story.**

3. **Read `retry_report.failed_requests` before reading `comments`.** A failed request drops that file from the review and the run **still exits 0 with a finding count** — three files vanished that way on the first real run here, and the result read as clean. Non-zero means the review is incomplete: fix it and re-run rather than triaging a partial. The known cause is in `{reviewer_config}`.

4. **Reconcile against the diff, and fail on empty.** Let `A` = `git diff --name-only main...HEAD`. **If `A` is empty, stop — you are on the wrong branch.** Every remaining path must appear in the run's manifest; one that appears in neither is unreviewed.

5. **Triage.** Expect the same defect filed once per file it touches — three times on `3450d7d` — and a tail of documentation-comment nits. Verify each finding against the real file before acting on it (step 7); `ocr` re-files comments across files itself and warns when it does. Fix test-first, run 8a's gate, commit, then go back to 1.

6. **Push before Section 5** — `glab mr create` builds the MR from the *remote* branch, so fix commits left unpushed are silently absent from it.

**Coverage is configured, not compiled in — check it before trusting a clean run.** `ocr` skips test files (`default_path`) and `.md` (`unsupported_ext`) **by default**. `rule.json`'s `include` key overrides both, and `{reviewer_config}` records the global file that does it here. Confirm it is live rather than assuming: `ocr review --from main --to HEAD --preview` must list your `.test.ts` files and your story file under *Will review*.

**Precedence, from `internal/agent/preview.go` `whyExcluded`:** user `exclude` (and `--exclude`) beats user `include`, which beats *both* built-in lists. `include` is additive — a path that does not match still gets the default treatment. So coverage goes up globally and is dialled back per run, never the other way about.

**`ocr` reading a test file is not the test-value pass, and does not replace it.** Measured on story 4.8's five test files at `5ebca8c^`, against four vacuous tests a reviewer had already found: it caught **one** — `expect(source).toContain('notifyFindings')` standing in for "alerting cannot fail the upload", named precisely and well argued. It missed the `toContain('12')` against a fixture amount of `1240.00`, the two reads of an unchanged table asserted to agree, and the assertion restating its neighbour. It also produced a **`high`-severity false positive** claiming green tests "will fail", specific enough and confident enough to act on — acting on it would have damaged a correct test.

It was tuned on a benchmark that excludes test files, so its judgement is weakest exactly where this project's defect class lives. **Argus and 8a's test-value pass stay load-bearing**, and every test-file finding is verified against the code before it is acted on.

**7. Validate every finding before any of it reaches `argus_ingest`.** CodeRabbit's output was treated as ground truth and ingested unverified. `ocr`'s must not be. `argus_ingest` writes *everything in its input that Argus did not find* to memory as a miss — so a false positive there is not noise, it is a lesson teaching Argus to reproduce it. On the story 4.8 test scan a `high` finding claimed green tests "will fail"; it was wrong, specific, and confidently argued. Ingested, it would have taught Argus to flag correct tests as broken.

   1. **Verify each finding against the real file.** Confirmed = the cited code exists, says what the finding claims, and the defect would actually manifest. Everything else is refuted — including "plausible, but the code does not do that".
   2. **Dedup before counting.** `ocr` files one defect once per file it touches — three times on `3450d7d`. Three copies would become three lessons and skew the weighting.
   3. **Only confirmed, deduped findings are ingested.** Record the refuted ones in Review Findings rather than discarding them silently: a reviewer's false-positive rate is a fact about the reviewer, and this one's is not zero.
   4. **Severity maps into CodeRabbit's vocabulary**, which is what `argus_ingest` reads: `critical→critical`, `high→major`, `medium→minor`, `low→trivial`. It records critical and major by default, so an `ocr` `medium` is ingested only with `severities` overridden.
   5. **Ingest before fixing, and pass `commit` explicitly.** A later round reviews different code and cannot score this one; without `commit` the join finds nothing and it silently learns nothing.

   **The converter is `scripts/ocr-to-argus.mjs`.** No change was needed in the argus repo: its CLI adapter reads generic field names (`comment`, `fileName`, `line`, `severity`, `category`) and guards only on the event `type`, so a synthesised stream is accepted like any other.

   ```bash
   node scripts/ocr-to-argus.mjs --in .argus/ocr.json --list        # verify each, then
   node scripts/ocr-to-argus.mjs --in .argus/ocr.json --commit $COMMIT \
     --confirmed 4,9 --reviewed-from main...HEAD --out .argus/ocr-review.jsonl
   ```

   `--confirmed` is required — there is no carry-everything path — and `--confirmed none` is legitimate: a review that confirmed nothing is not the same as a review that never ran. It refuses outright when `retry_report.failed_requests` is non-zero, so a partial review cannot become a lesson. Give it `--reviewed-from` or `--reviewed`: `reviewedFiles` carries what was reviewed **and clean**, which a finding list cannot express, and deriving it from the findings would tell Argus that every clean file went unreviewed.

   Then `argus_ingest` with `from: .argus/ocr-review.jsonl` and `commit: $COMMIT`.

   **Findings ingest as `source: "coderabbit"`** — the adapter hard-codes it. Harmless to what Argus learns, wrong in the record; correcting it is a change in the argus repo, not this one.

### 4c — The AC audit, before the MR

**For each acceptance criterion, name the test that would fail if the behaviour were removed — and show it would.** Record `path::case`, then for each either cite the round where its sensitivity was already proven or run the Step 9 check now: break the covered behaviour, confirm that case fails, restore.

A criterion you cannot name a test for is not implemented, whatever the code looks like. **And a name alone is not evidence** — a vacuous test satisfies "I named one" while staying green when the behaviour is deleted, which is the defect this project keeps finding. Naming without the sensitivity result makes the audit unfalsifiable by exactly the failure it exists to catch.

It has found something on **nine consecutive stories** — an AC read by the adapter, carried by the port and rendered by nothing; a URL parameter the page and its export read two different ways; and on 4.8 an AC nothing had implemented at all. It runs **here, not after the reviews**: on 3.8 that difference was a fix in the same branch versus a follow-up MR.

Cheap and mechanical. Do not skip it because the story felt thorough — that is the condition under which it keeps finding things.

### 5 — Merge request to main

1. Existing? `glab api "projects/{enc}/merge_requests?source_branch={branch}&state=opened&target_branch=main"`. Filter on the target: an open MR from this branch to anything else must **stop the run** — opening a second MR from the same source is worse. Report it and let the user close or retarget it.
2. Else write the description to a scratch file `{description_file}` and run `glab mr create --source-branch {branch} --target-branch main --title "{story_id}: {title}" --description "$(cat {description_file})" --yes`. **The body must come from a file** — backticks in a double-quoted bash string get command-substituted. `--title` is exposed the same way and is not file-backed: strip or escape backtick, `$`, `"` and `\` in `{title}` before interpolating it. `{description_file}` is a scratch path you choose, not `story_file` and not a literal `file`.
3. **Must target `main`.** The predecessor gate in step 2 and `bmad-implement-epic` both assume it; another target strands the story outside the epic's merge order.
4. Record `mr_iid`/`mr_url`, report the URL, and write `merge_request: {mr_iid}` into the story frontmatter — the epic loop uses it to verify the merge rather than trusting a status word.

### 6 — Local adversarial review: the **integration** pass

**Not the only review.** `_bmad/custom/review-gate.md` is the authoritative contract: **every diff that will reach `main` gets both checks** — each task's diff (Step 9 of `bmad-dev-tdd`), this whole-story pass, and **every review-fix push in Step 8a**. This step is what per-task reviews structurally cannot be: a look at the whole change at once, where an interaction between task 2's schema and task 3's write path is visible.

**This step is not optional and has been skipped before.** Stories 1.5c and 1.5d were implemented, gated and nearly shipped without it, with per-task mutation testing silently standing in for it. It does not stand in for it: on 1.5d the review found **four** defects after 29 mutations had found none of them, one of which showed "Reading" to a treasurer forever for a document that had been read.

Invoke **`bmad-code-review`** (not the lighter built-in `code-review`) on `baseline_commit..HEAD` (fallback `main...HEAD`), passing `story_file` as the spec for **`full`** mode. It writes to the story's `### Review Findings` — the audit trail. State the scope you reviewed and anything you excluded; the story document is the spec and reviewing it as a diff reviews the prose against itself.

**Verify every finding against the real file before acting on it** (`_bmad/custom/argus-review-routing.md` §5). The engine reasons from a token-budgeted slice and can cite code it only partly saw. On 1.5d that discipline sharpened one finding's mechanism and turned another from a patch into a decision for the user.

Under `/loop` choose **Apply every patch**; surface and STOP on anything needing a human call. Fix **test-first** — a review fix without a regression test is moved, not fixed. Re-run the gates, commit, push.

**Look hardest at guards that prove nothing** — a check that passes whether or not the thing it guards against is present. Ten found on this project: a bare `rejects.toThrow()` that also passes when the table is absent; a loop over an empty list; a `Promise.all` "concurrency" test that passed against a deliberately racy implementation; a `requestTimeout` that only logged a warning. Tool: the `bmad-dev-tdd` Step 9 sensitivity check — break the covered code, confirm the test fails, restore.

### 7 — Verify the head, locally

Run `{gate}` — the whole of it — **on the exact head the MR points at**. Not the run from before the close-out commit: that was a different head.

**Where `{ci}` is none, this run is the only evidence that head is green.** There is no second opinion and no external record, so an unrun check is simply an unmade claim. Do not wait for a pipeline, report its status, or treat its absence as a failure.

Report it as what it is: "gates green locally on `<sha>`".

### 8 — The fix-diff gate, and the close-out

**8a. Every fix diff gets the gate before it is committed** — sensitivity check, **test-value pass**, and one `argus_review` scoped to what the round touched. `_bmad/custom/review-gate.md` is the authoritative contract. This applies to fixes from 4b, from Section 6, and to anything Section 7 turns up.

**One commit and one push per round.** Fix every finding in the round first, then gate, then commit. Batching gives the reviewer the round as one diff, which is how a fix that breaks a sibling fix becomes visible; on 1.6b two such defects were found only because something looked at the fix diff whole.

**A finding that asks you to weaken one of `{invariants}` is an architecture decision for the user, not a fix** — route it there and say so. Verify factual claims before acting: read the installed types, run the probe, grep the config. Skip low-value nits with a written reason, preferably recorded in the code or migration itself.

**Caps:** ~3–4 rounds; a round that only repeats already-skipped findings counts as clean.

The test-value pass matters most *here*, because a fix diff is where a test's premise expires. `python3 _bmad/scripts/tests_touched.py <range>` lists the cases the fix touched; for each, ask **vacuous?** and **expired?**

- **Vacuous** in *two* directions, and breaking the code only finds one. Break the **code** it covers — still green means it proves nothing. Then break the **fixture**: change the input so the expected outcome must change, leaving the code and the expected value alone — still green means the *input* was satisfying the assertion, not the code. Restore it and re-run before moving on; a mutated input left in the diff reads as a real test case. Story 4.8 shipped four of the second kind and the sensitivity check caught none: `toContain('12')` against an amount of `1240.00`; two reads of an unchanged table asserted to agree; an assertion restating its neighbour; a cap on an input that never reached it. A reviewer found all four.
- **Expired** — does it assert something a later decision made wrong? A mutation is blind to this: an expired test fails loudly when you break the code, so it looks healthy. Story 1.5d shipped two, each blocking the fix it should have driven. Then check what *lost* cover — re-specifying a test can strip the only assertion from a behaviour that is still correct, and the suite goes greener, so nothing complains.

**A fix is the highest-risk diff in the story, not the lowest.** On story 1.5d, rounds 2 and 3 produced **8 findings and every one was in a fix from a previous round** — a swallowed 404, a stale read that reintroduced the bug it was fixing, a `NULL` token written against a check constraint. Fixes are written under time pressure, against a narrower model, on machinery with invariants already in place. Skipping the gate here is skipping it where it pays most.

**8b. The close-out rides in the last round's commit, not after it.** Story `Status: done`, Change Log entry, `development_status[{story_key}] = done` + `last_updated`, and the round's Review Findings — all in the **same commit and push** as the round's fixes. Not a commit of its own once the reviews come back clean.

Because a story with no fixes this round still has a round: if the review was clean and nothing needed changing, the close-out *is* the commit.

**Why: a close-out pushed after convergence races the merge, and loses.** You announce ready-to-merge, the user merges the head they were shown, and the close-out lands on the branch behind them — so `main` keeps `Status: review`. Step 1 then picks the *finished* story again instead of the next one. That has needed a follow-up docs MR five times: stories 2.1, 2.6, 2.7, 3.2 and 4.4 (MR !57).

Marking `done` before the final gate run is safe because Section 9 re-runs it on the exact head and 9.3 specifies the undo. `done` on an unmerged branch means ready-to-merge, and a further round simply amends it.

### 9 — Ready-to-merge (terminal)

1. **The docs are already pushed** — 8b put them in the round's commit. Confirm rather than write: story `Status: done`, Change Log entry, `development_status[{story_key}] = done` + `last_updated`, and `epic-{N} = done` if this was the epic's last not-`done` story (otherwise `in-progress` if unset). **If any is missing, this step is the bug** — commit and push it now, and expect step 2 to cost a re-review.
2. **Verify on the exact head the MR points at.** No new push means the Step 7/8 evidence still stands; re-run the gates anyway, because with no pipeline that run is the *whole* of the evidence. If you did have to push in step 1, re-run 8a's gate on the new head — a docs-only push is still a diff that reaches `main`.
3. **If verification fails, undo the status before stopping.** Restore the story to `Status: review`, restore `development_status[{story_key}]` and any `epic-{N}` change, commit and push, then STOP with the failure. A story left reading `done` on a red head both breaks the hard rule above and makes `bmad-implement-epic` skip it, since the loop iterates only over not-`done` stories.
4. **Confirm the MR is still open at your head** before reporting.
5. Report MR URL, review outcome, and the **local gate results on the final head** — naming them as local, since no pipeline corroborates them. Then **"Ready to merge — leaving the merge to you."**
6. STOP.

**`done` means ready-to-merge, not merged** — it is written on an unmerged branch. Nothing downstream may treat it as proof of a merge.

## Stacking (exception, on request only)

If the user wants to keep building without merging, branch off the previous *story* branch and say in the MR description that the diff includes the parent. Default is to wait — stacking reintroduces the reviewability problem this design removes.

## Driving with /loop

`/loop ship story {id}`. **The review is synchronous now, so there is no watch phase and nothing to wait for** — one tick runs 0–9 and the loop ends at Step 9. Under `/loop` choose **Apply every patch** in Section 6, and STOP on anything needing a human call.

The scheduled waits this section used to specify went with the MR-side reviewer. A step that blocks now blocks on a real failure: surface it and stop, rather than scheduling a retry.

## Project bindings

**Everything project-specific is in this block.** Porting this skill to another repository means editing the table and the two lists below it — the workflow above refers to them by name and contains no other repo-specific value.

| Binding | This project |
| --- | --- |
| `{project}` | `ageem123/hoa-treasurer-assistant` |
| `{project_encoded}` | `ageem123%2Fhoa-treasurer-assistant` |
| `{glab_path}` | `/c/Users/magee/AppData/Local/Programs/glab` |
| `{reviewer_config}` | `ocr` (alibaba/open-code-review) v1.9.7 via OpenRouter, model `qwen/qwen3.7-plus`. Two files, both at `~/.opencodereview/`, **outside the repo**, so a fresh checkout carries neither. **`config.json`** — `custom_providers.<name>.extra_body` must set `{"reasoning":{"enabled":false},"enable_thinking":false}`, because Qwen returns a 400 on `tool_choice: required` in thinking mode and that is what drops files at 4b.3; setting `llm.extra_body` instead does nothing while a provider is active, and `ocr` says so. **`rule.json`** — `{"include": ["**/*.test.{js,jsx,ts,tsx}", "**/*.spec.{js,jsx,ts,tsx}", "**/__tests__/**", "**/*_test.py", "**/*_test.go", "**/*.md"]}`, which is what makes tests and markdown reviewable at all. |
| `{ci}` | **none** — removed 2026-08-07, per-minute billing (AD-2's amendment). `.github/workflows/ci.yml` is vestigial |
| `{tsc_baseline}` | 8 pre-existing errors |

**`{gate}` — what "tested" means here.** Every command, every time; a partial run is an unmade claim.

- `npm run lint` + `npm run build` + `npm test`
- `npm run test:db` for schema, adapter or `app/tools/` work. It runs *nowhere* unless someone runs it, which makes AD-4's SELECT-only proof and AD-13's idempotency constraints locally-verified only
- `npm run test:py` for anything under `agent/` **or for the gate itself** — `scripts/run-pytest.mjs` and the `test:py` script define it, so changing them without running it is the one edit that can silently disable a gate. It runs pytest on the pinned 3.13, never the ambient 3.14: CrewAI's `requires_python` is `<3.14,>=3.10`, so AD-15 pins it and `agent/.venv` is built with it. The script refuses rather than falling back, because a gate on the wrong runtime reports green from an environment CrewAI cannot be installed into
- `npx --no-install tsc --noEmit`, compared against `{tsc_baseline}`. Neither ESLint nor Vitest type-checks and `npm run build` skips test files, so this is the only thing that sees them — it caught real errors in three consecutive stories that lint and build both passed

**`{invariants}` — what a review may not trade away.** A finding asking you to weaken one is an architecture decision for the user, not a fix.

- NFR-2/AD-2 — no banking, payment-rail or external-accounting credential anywhere (`core/security/nfr2-guard.test.ts`)
- AD-4 — the reader database role is SELECT-only
- AD-13 — content-hash idempotency is a database constraint
- `core/` imports nothing outward (`core/ports/boundary.test.ts`)

**Repo hygiene.** Committed: `_bmad-output/`. Ignored: `.claude/` except tracked skills, `.agents/`, `_bmad/`, `node_modules/`, `.next/`, `.probe/`, `envprobe`, `.env*.local`. Benign: Git's CRLF warnings.

## Practice — portable

These hold in any repository and travel with the skill unchanged.

- **Status flow:** `backlog → ready-for-dev → in-progress → review → done`. `baseline_commit` defines the review diff range.
- **`ocr` (alibaba/open-code-review):** local, synchronous, no rate limit — cost is the only budget. Precision-first by design; its README states the lower recall openly. It skips tests and non-code extensions by default; `rule.json`'s `include` re-enables them and outranks both built-in filters. Re-enabling is not the same as being good at them — on tests it scored 1 of 4 known defects and added a confident false positive, so **it is never the whole review**. It needs the spec supplied via `-B` to find anything but form, and it reports a finding count even when requests failed — check `retry_report.failed_requests` first, every time.
- **Any scripted edit is read back afterwards.** Not "be careful with heredocs" — that rule existed and was broken anyway. An anchored replacement whose assertion fails is a change that did not happen: one was reported as fixed on a review thread and the reviewer's next round caught it. Verify the **replacement**, not just the presence of new text: a grep for the new string passes when that string already existed elsewhere, or when the old text is still sitting at the target. Check the old text is gone and the match count is what you expected.
- **Shell gotchas:** backticks inside double-quoted bash strings are command-substituted (write bodies to files); `glab api --field "body=$(cat f)"` **fails if the body starts with `@`** — glab reads a leading `@` as a filename and errors with "The filename, directory name, or volume label syntax is incorrect", or silently posts nothing; use `glab mr note create` for any body that could start with one; PowerShell here-strings don't work in the Bash tool; `git show origin/branch:path` is mangled by Windows path conversion (use `git cat-file -p <blob>`); run one test file with `npm test -- <substring>`, never `npx vitest run` (fails here, and `npx` fetches unpinned packages); never `npx prettier` — no config, and its defaults fight the house style.
