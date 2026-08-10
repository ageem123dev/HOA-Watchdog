---
name: bmad-ship-story
description: 'Run a single story end-to-end on its own branch: create it, implement it test-first, review it locally, open a merge request to main, and run the CodeRabbit loop until the MR is clean and ready-to-merge. Use when the user says "ship a story", "ship the next story", "run the story pipeline", or "ship story <id>". Designed to be driven by /loop for the review-watch phase, and to be called in a loop by bmad-implement-epic.'
---

# Ship Story Pipeline

Take one story to a green, reviewed, ready-to-merge MR. **One story = one branch = one MR = one review cycle** — story-sized diffs are the largest a reviewer can hold in their head.

Resumable: every run detects state from `sprint-status.yaml`, git and the MR, then advances. Safe to re-run. Step 8 is the `/loop` tick.

## Conventions

- `implementation_artifacts` = `_bmad-output/implementation-artifacts`; `sprint_status` = that + `/sprint-status.yaml`; `story_file` = that + `/{story_key}.md`.
- **GitLab only.** `glab` for all remote ops; MRs not PRs. **There is no CI** — the pipeline was removed on 2026-08-07 because GitLab bills per minute (see AD-2's amendment). `.github/workflows/ci.yml` is vestigial and does not run either.
- Project path `ageem123/hoa-treasurer-assistant`, encoded `ageem123%2Fhoa-treasurer-assistant` for `glab api`.
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

`glab auth status` and `git` available. If `glab` is missing from PATH: `export PATH="$PATH:/c/Users/magee/AppData/Local/Programs/glab"`. Read `sprint_status` fully — order matters.

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

### 4b — The one local CodeRabbit review, before the MR exists

**Exactly one CLI round per story.** Fix everything it raises, then Section 5 — CodeRabbit reviews the MR itself, and that is the second look at the fixes.

The first review finds the most. Story 1.6b took 8 rounds and ~11 pushes; moving the first round here took 1.6c and 1.6d to one each.

**One base for the whole step: local `main`, fast-forwarded at step 2.** Argus, the CLI and the diff checks all use it; mixing in `origin/main` means they score different diffs the moment anyone merges upstream mid-round.

The CLI is Linux/macOS only, so it runs in WSL against the Windows checkout.

1. **`argus_review` first** (`git_range: main...HEAD`). Fix what it finds test-first, run 8e's *gate* on the fix diff — sensitivity check and test-value pass, not its push — and commit. The CLI round is the scarce one; spending it on defects Argus already named wastes it.
2. **`argus_review` again on that commit**, unless item 1 found nothing and nothing was committed. `argus_ingest` joins the two reviews on commit SHA and *skips* a CodeRabbit review with no Argus run on it, so the CLI round must see a SHA an Argus run saw.
3. **Record the SHA, then review.** The stream carries no commit, so the join key is whatever is captured here — nothing may commit between these two lines:

   ```bash
   COMMIT=$(git rev-parse HEAD)
   wsl.exe -e bash -lc 'export PATH="$HOME/.local/bin:$PATH"; coderabbit review      --dir /mnt/c/Users/magee/repos/HOA-Treasurer-Assistant      --base main --committed --agent' > .argus/cr.jsonl 2> .argus/cr.err
   ```

   No user action, and it does not re-trigger on a push. Minutes, not seconds; `/mnt/c` is the slow part. Capture stderr — an error otherwise leaves an empty file and no reason.
4. **Accept only `status: "review_completed"` on the `complete` event.** `review_skipped` is not a clean review, and neither is an empty or unparseable file: the adapter returns *zero reviews* for those, which is not the same as one review with zero findings. Treating them alike is the false-clean 8c exists to refuse.
5. **Reconcile against the diff, and fail on empty.** Let `A` = `git diff --name-only main...HEAD`. **If `A` is empty, stop — you are on the wrong branch.** Otherwise every path in `A` must appear in the `complete` event's `reviewedFiles`; a path in neither is unreviewed. `reviewedFiles` also names the files reviewed and *clean* — 25 against 10 findings in the first capture — which a finding list cannot express.
6. **`argus_ingest` with both `from` and `commit`.** `from: .argus/cr.jsonl`, `commit: $COMMIT`. **Without `commit` it silently learns nothing**, because the stream has no SHA to join on and an unjoinable review is skipped. Severities come from committed `argus.config.json` (critical + major). **Default `dry_run: false`** — that is the call that writes. Ingest before fixing; a later round reviews different code and cannot score this one.
7. Fix test-first, run the same gate, commit. **Do not run a second CLI round.** Then `argus_review` on that fix commit, so the MR round has a SHA to join on.
8. **Push before Section 5** (*Merge request to main*). `glab mr create` builds the MR from the *remote* branch, so fix commits left unpushed are silently absent from it.

CLI reviews are **3/hr per developer** on Free and OSS (Pro 5, Pro+ 10) — a rolling window, not a daily quota, so capacity returns as earlier reviews age out. That is three times the extension's 1/hr, and it is a *separate* pool from the MR reviews Section 8 spends. The single round above therefore stands on its own merits — the first review finds the most, and a second costs minutes for little — not on scarcity.

**The CLI ignores `.coderabbit.yaml` `path_filters` too.** The 2026-08-09 capture reviewed `_bmad-output/**`, which the file excludes. Expect the local round to review more than the merge request will.

### 5 — Merge request to main

1. Existing? `glab api "projects/{enc}/merge_requests?source_branch={branch}&state=opened&target_branch=main"`. Filter on the target: an open MR from this branch to anything else must **stop the run** — it gets no CodeRabbit review (see 3), and opening a second MR from the same source is worse. Report it and let the user close or retarget it.
2. Else write the description to a scratch file `{description_file}` and run `glab mr create --source-branch {branch} --target-branch main --title "{story_id}: {title}" --description "$(cat {description_file})" --yes`. **The body must come from a file** — backticks in a double-quoted bash string get command-substituted. `--title` is exposed the same way and is not file-backed: strip or escape backtick, `$`, `"` and `\` in `{title}` before interpolating it. `{description_file}` is a scratch path you choose, not `story_file` and not a literal `file`.
3. **Must target `main`.** `.coderabbit.yaml` sets `auto_review.base_branches: [main]`; any other target gets no review at all.
4. Record `mr_iid`/`mr_url`, report the URL, and write `merge_request: {mr_iid}` into the story frontmatter — the epic loop uses it to verify the merge rather than trusting a status word.

### 6 — Local adversarial review: the **integration** pass

**Not the only review.** `_bmad/custom/review-gate.md` is the authoritative contract: **every diff that will reach `main` gets both checks** — each task's diff (Step 9 of `bmad-dev-tdd`), this whole-story pass, and **every review-fix push in Step 8e**. This step is what per-task reviews structurally cannot be: a look at the whole change at once, where an interaction between task 2's schema and task 3's write path is visible.

**This step is not optional and has been skipped before.** Stories 1.5c and 1.5d were implemented, gated and nearly shipped without it, with per-task mutation testing silently standing in for it. It does not stand in for it: on 1.5d the review found **four** defects after 29 mutations had found none of them, one of which showed "Reading" to a treasurer forever for a document that had been read.

Invoke **`bmad-code-review`** (not the lighter built-in `code-review`) on `baseline_commit..HEAD` (fallback `main...HEAD`), passing `story_file` as the spec for **`full`** mode. It writes to the story's `### Review Findings` — the audit trail. State the scope you reviewed and anything you excluded; the story document is the spec and reviewing it as a diff reviews the prose against itself.

**Verify every finding against the real file before acting on it** (`_bmad/custom/argus-review-routing.md` §5). The engine reasons from a token-budgeted slice and can cite code it only partly saw. On 1.5d that discipline sharpened one finding's mechanism and turned another from a patch into a decision for the user.

Under `/loop` choose **Apply every patch**; surface and STOP on anything needing a human call. Fix **test-first** — a review fix without a regression test is moved, not fixed. Re-run the gates, commit, push.

**Look hardest at guards that prove nothing** — a check that passes whether or not the thing it guards against is present. Ten found on this project: a bare `rejects.toThrow()` that also passes when the table is absent; a loop over an empty list; a `Promise.all` "concurrency" test that passed against a deliberately racy implementation; a `requestTimeout` that only logged a warning. Tool: the `bmad-dev-tdd` Step 9 sensitivity check — break the covered code, confirm the test fails, restore.

### 7 — Verify the head, locally

**There is no pipeline.** It was removed on 2026-08-07 — GitLab bills per minute on this account and the budget is not there. Do not wait for one, do not report its status, and do not treat its absence as a failure.

What replaced it is the gate you already ran before pushing: `npm run lint`, `npm run build`, `npm test`, plus `npm run test:db` for schema, adapter or `app/tools/` work and `npx --no-install tsc --noEmit` against its baseline. **Re-run them on the exact head the MR points at**, because that is now the only evidence that head is green, and there is no second opinion.

Say so honestly when reporting: "gates green locally on `<sha>`" is true; "pipeline green" is not, and there is nothing to link to.

### 8 — CodeRabbit loop (the `/loop` tick)

**8a. Wait first.** A review takes ~20 min on a new MR, ~4 after a fix push; checking earlier cannot succeed. Time it from the MR's `created_at`, or from the push that made the current head. Under `/loop` that wait is the next `ScheduleWakeup`; standalone, say when the review is due and STOP.

**On waking, before reading anything:** confirm the MR is still `opened` and its `sha` is still yours. A merge can land while you sleep — that happened on story 1.5 — and 8e would then push fixes to a branch about to be deleted. If either changed, stop and move any unmerged commits to a fresh branch and MR.

**8b. Read the review.** CodeRabbit posts as a **service account** (`service_account_group_138854092_…`), not a name containing "coderabbit" — filtering on the name finds nothing and looks like "no review yet". Fetch `.../merge_requests/{iid}/notes?per_page=100&sort=desc` and match **`Actionable comments posted: N`**; that line is the review. Threads from `.../discussions`. Only trust one whose commit matches the current head.

`per_page=100` is **one page** — story 1.5's MR reached 64 notes, and replies push a review down fast. Follow `X-Next-Page` until the current-head review is found or the pages run out. Concluding "no review" from page one is the same absence-of-evidence error in a new place.

A review announces itself in **four** shapes. Match all of them, and read the note body rather than trusting its first line:

| Shape | Means |
| --- | --- |
| `Actionable comments posted: N` | N findings |
| **`No actionable comments were generated`** | **reviewed and clean — this is how convergence actually arrives** |
| `Duplicate comments (N)` | an incremental re-review of repeats; carries **no** actionable line |
| `Outside diff range comments (N)` | findings that could not be posted inline |

The clean shape is the one that matters most: keying only on `Actionable comments posted:` means a clean MR **never converges** and the loop waits forever for a line that is never coming. That happened on MR !8 — reviewed clean in 24 seconds, reported as "awaiting review" for an hour.

A note is a review only if it carries a `Commits` / `Files selected for processing` block. The **summary comment** (`<!-- … summarize by coderabbit.ai -->`) does not, and carries no findings. Do not treat a stray `rate limited` string as proof either — it appears in stale fragments of otherwise-complete reviews.

**8c. Convergence.** Precondition: a service-account review matching the current head, in any of 8b's four shapes. Without it nothing below applies — "zero unresolved threads" and "no review yet" are both true *before* any review, so a predicate lacking this precondition reports a never-reviewed story clean. An earlier version of this file did.

Converged = the local gates green on the current head AND every finding **fixed** (push → new head → back to 8a), **skipped** with a reason on its thread, or **resolved by CodeRabbit**. Anything else is pending — including a review still missing after the wait.

**8d. Triage.** Fix real correctness/security/accessibility issues. **Verify factual claims first** — read the installed types, run the probe, grep the config; CodeRabbit correctly caught that `requestTimeout` doesn't bound socket idleness, and in the same round wrongly asserted the repo runs markdownlint. Skip low-value nits with a written reason, preferably recorded in the code or migration itself.

**8e. Apply — one commit and one push per round.** Fix **every** finding in the round first, then **run the review gate on the whole round's diff before pushing** — sensitivity check, **test-value pass**, and one `argus_review` scoped to what the round touched (`_bmad/custom/review-gate.md`). Then **one** commit, **one** push.

**A push does not reliably trigger a review, and batching does not change that.** CodeRabbit pauses automatic reviews after `auto_pause_after_reviewed_commits` (set to 25 here, default 5), and a paused branch stays paused until asked. So after every push: **confirm a review body exists for the current head**; if none arrives, post `@coderabbitai review` and wait for it. A pause is indistinguishable from a clean review from the outside — which is the false-clean 8c exists to refuse.

**Not a commit per finding.** Story 1.6b answered 4 rounds with 12 commits, and each one cost a re-review and a place in CodeRabbit's `auto_pause_after_reviewed_commits` budget — it paused itself mid-story twice, which from outside is indistinguishable from a clean review. Batching also gives the reviewer the round as one diff, which is how a fix that breaks a sibling fix becomes visible; on 1.6b two such defects were found only because something looked at the fix diff whole.

Keep the reasoning that would have gone in several messages — write it as sections of one commit body rather than losing it.

The test-value pass matters most *here*, because a fix diff is where a test's premise expires. `python3 _bmad/scripts/tests_touched.py <range>` lists the cases the fix touched; for each, ask whether it is **vacuous** (break the code — does it fail?) and whether its premise is **expired** (does it assert something a later decision made wrong?). A mutation finds the first and is blind to the second: an expired test fails loudly when you break the code, so it looks healthy. Story 1.5d shipped two, each blocking the fix it should have driven. Then check what *lost* cover — re-specifying a test can strip the only assertion from a behaviour that is still correct, and the suite goes greener, so nothing complains.

**A fix is the highest-risk diff in the story, not the lowest.** On story 1.5d, rounds 2 and 3 produced **8 findings and every one was in a fix from a previous round** — a swallowed 404, a stale read that reintroduced the bug it was fixing, a `NULL` token written against a check constraint. Fixes are written under time pressure, against a narrower model, on machinery with invariants already in place. Skipping the gate here is skipping it where it pays most.

**8f. Reply per thread** — Fixed (what changed) or Skipped (why). **Write bodies to files** and post with `--field "body=$(cat file)"`.

**Caps:** ~3–4 rounds; only-already-skipped findings recurring counts as converged. On a rate limit, back off ~2400s and re-request rather than pushing.

### 9 — Ready-to-merge (terminal)

1. **Docs first.** Story `Status: done`, Change Log entry, `development_status[{story_key}] = done` + `last_updated`. If this is the epic's last not-`done` story also set `epic-{N} = done` in the same commit; otherwise set it `in-progress` if unset. Commit and push.
2. **Re-verify on the new head.** That push invalidated the Step 7/8 evidence. Re-run the gates, then Step 8 **including 8a's wait** — a docs-only push triggers a re-review like any other. With no pipeline, the re-run is the *whole* of the evidence, not a confirmation of it.
3. **If that re-verification fails, undo the status before stopping.** Restore the story to `Status: review`, restore `development_status[{story_key}]` and any `epic-{N}` change, commit and push, then STOP with the failure. A story left reading `done` on a red head both breaks the hard rule above and makes `bmad-implement-epic` skip it, since the loop iterates only over not-`done` stories.
4. **Confirm the MR is still open at your head**, as in 8a, before reporting.
5. Report MR URL, review outcome, and the **local gate results on the final head** — naming them as local, since no pipeline corroborates them. Then **"Ready to merge — leaving the merge to you."**
6. STOP.

**`done` means ready-to-merge, not merged** — it is written on an unmerged branch. Nothing downstream may treat it as proof of a merge.

## Stacking (exception, on request only)

If the user wants to keep building without merging, branch off the previous *story* branch and say in the MR description that the diff includes the parent. Default is to wait — stacking reintroduces the reviewability problem this design removes.

## Driving with /loop

`/loop ship story {id}`. Early ticks run 1–7 once; later ticks sit in Step 8; the loop ends at Step 9.

Cadence is 8a's waits, scheduled not polled: ~1200s after opening, ~270s after a fix push, ~2400s after a rate limit. A foreground `sleep` is blocked. Standalone: run 0–7, STOP at 8a, say when the review is due.

## Project facts

- **"Tested" = `npm run lint` + `npm run build` + `npm test`**, plus `npm run test:db` for schema, adapter or `app/tools/` work, plus `pytest` once the Python service exists. **Neither ESLint nor Vitest type-checks**, and `npm run build` does not check test files — so also run **`npx --no-install tsc --noEmit`** and compare against its baseline of 8 pre-existing errors. It caught real errors in three consecutive stories that lint and build both passed.
- **This list is the only gate there is.** With CI removed there is no second chance and no external record: an unrun check is simply an unmade claim. `npm run test:db` in particular now runs *nowhere* unless someone runs it, which makes AD-4's SELECT-only proof and AD-13's idempotency constraints locally-verified only.
- **Python is in scope** — `python3` is installed and the PRD puts a CrewAI service in the architecture.
- **Status flow:** `backlog → ready-for-dev → in-progress → review → done`. `baseline_commit` defines the review diff range.
- **CodeRabbit:** `.coderabbit.yaml`, `auto_review.base_branches: [main]`. Pro is free on public repos and the tier binds at MR-open time. Posts as a service account, findings in the review body, resolves threads itself when satisfied, hourly rate limits.
- **Invariants a review must not trade away:** NFR-2/AD-2 (no banking, payment-rail, or external-accounting credential anywhere, enforced by `core/security/nfr2-guard.test.ts`); AD-4 (reader role is SELECT-only); AD-13 (content-hash idempotency is a DB constraint); `core/` imports nothing outward (`core/ports/boundary.test.ts`). A finding asking you to weaken one is an architecture decision for the user, not a fix.
- **Committed:** `_bmad-output/`. **Ignored:** `.claude/` except tracked skills, `.agents/`, `_bmad/`, `node_modules/`, `.next/`, `.probe/`, `envprobe`, `.env*.local`. Benign: Git's CRLF warnings.
- **Shell gotchas:** backticks inside double-quoted bash strings are command-substituted (write bodies to files); `glab api --field "body=$(cat f)"` **fails if the body starts with `@`** — glab reads a leading `@` as a filename, so every `@coderabbitai review` request errors with "The filename, directory name, or volume label syntax is incorrect"; use `glab mr note create` for those; PowerShell here-strings don't work in the Bash tool; `git show origin/branch:path` is mangled by Windows path conversion (use `git cat-file -p <blob>`); run one test file with `npm test -- <substring>`, never `npx vitest run` (fails here, and `npx` fetches unpinned packages); never `npx prettier` — no config, and its defaults fight the house style.
