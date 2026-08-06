---
name: bmad-ship-story
description: 'Run a single story end-to-end on its own branch: create it, implement it test-first, review it locally, open a merge request to main, and run the CodeRabbit loop until the MR is clean and ready-to-merge. Use when the user says "ship a story", "ship the next story", "run the story pipeline", or "ship story <id>". Designed to be driven by /loop for the review-watch phase, and to be called in a loop by bmad-implement-epic.'
---

# Ship Story Pipeline

Take one story to a green, reviewed, ready-to-merge MR. **One story = one branch = one MR = one review cycle** — story-sized diffs are the largest a reviewer can hold in their head.

Resumable: every run detects state from `sprint-status.yaml`, git and the MR, then advances. Safe to re-run. Step 8 is the `/loop` tick.

## Conventions

- `implementation_artifacts` = `_bmad-output/implementation-artifacts`; `sprint_status` = that + `/sprint-status.yaml`; `story_file` = that + `/{story_key}.md`.
- **GitLab only.** `glab` for all remote ops; MRs not PRs; `.gitlab-ci.yml` is the pipeline (`.github/workflows/ci.yml` is vestigial and does not run).
- Project path `ageem123/hoa-treasurer-assistant`, encoded `ageem123%2Fhoa-treasurer-assistant` for `glab api`.
- Never guess CI/MR state — query it.

## Hard rules

- **Never merge, never push to `main`.** Terminal state is ready-to-merge.
- **Never commit secrets.** `.env*.local` stay gitignored; never `git add -f`.
- **Never weaken, skip, or delete a test** to get a green suite, pipeline, or review. Fix the code or STOP with the conflict stated.
- **Never mark a story `done` on unverified work** — all tasks checked, lint+build+test clean, pipeline green on the final head, no open actionable feedback.
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
- **A story adding a gate must add it to `.gitlab-ci.yml`.** A gate that runs only locally is not a gate.
- Pass `story_path` explicitly so its discovery menu never fires under `/loop`.
- Run `python3 _bmad/scripts/resolve_customization.py` as its Steps 1 and 11 instruct; hand-merge TOML only if it errors.
- **A HALT is a real halt** — ambiguous AC, untestable design, test/code conflict. Surface and STOP.

Then commit (trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`) and `git push -u origin story/{story_key}`.

### 4b — First CodeRabbit review, in the IDE, before the MR exists

The first review finds the most, and every round moved off the MR is a pipeline not billed. Story 1.6b took 8 rounds and ~11 pushes.

**One base for the whole step: local `main`, fast-forwarded at item 2.** The extension bases on it and cannot be told otherwise, so Argus and the diff checks use it too; mixing in `origin/main` means Argus and CodeRabbit score different diffs the moment anyone merges upstream mid-round.

1. **Run `argus_review` on this commit first** (`git_range: main...HEAD`). `argus_ingest` joins the two reviews on commit SHA and *skips* a CodeRabbit review with no Argus run on that commit, so reviewing second teaches nothing.
2. Ask the user for **CodeRabbit → Start Review**, base `main`, scope **committed changes**. Fast-forward local `main` first (Section 2 does). Started by hand, and it does **not** re-trigger on a push; ask once per round and STOP until it finishes (~8–11 min for a handful of files).
3. Read the record at `%APPDATA%\Code\User\workspaceStorage\{ws}\coderabbit.coderabbit-vscode\{sha256}.json` — `{ws}` is the directory whose `workspace.json` names this repo, `{sha256}` hashes `{repoRoot}-{branch}-reviews`. Derive `{repoRoot}` from `git rev-parse --show-toplevel` as a Windows path with a lower-case drive letter (`c:\Users\...`), which is the form the extension hashes; do not hard-code it. It is **workspaceStorage, not globalStorage**.
4. **Accept it only if `status` is `completed` AND `headCommitId` == `git rev-parse HEAD` AND `baseCommitId` == `git rev-parse main`.** Both stored values are 40-char SHAs, not ref names. The key alone also matches a clean review taken before your last fix commit, which would pass unreviewed code as converged — 8c's precondition, in a new place.
5. **Reconcile the file lists, and fail on empty.** Let `D` = `git diff --name-only main...HEAD` less `path_filters`. **If `D` is empty, stop — you are on the wrong branch.** An empty `D` matches an empty `fileReviewMap` and reads as clean; that is how this step's first run passed with the tree on `main`. Then check both directions, neither of which is equality:
   - **Every path in `D` must appear in *some* round's `fileReviewMap` on this branch, not necessarily this one.** Re-reviews are incremental — round 2 here skipped `.coderabbit.yaml` and `.gitlab-ci.yml` because they had not changed since round 1. Union the rounds; a path in no round is unreviewed.
   - **Paths reviewed but not in `D` mean the scope leaked.** The extension picks up uncommitted and untracked files whatever the scope setting says — round 2 pulled in `.mcp.json`, `.gitignore` and `.claude/commands/`. Their findings are real but belong to another branch; triage them separately and do not fix them here.
6. Findings: `fileReviewMap[path].comments[]` (`severity`, `startLine`, `comment`), totalled in `additionalDetails.counts`.
7. **`argus_ingest` once the review is read**, every round. It scores the Argus run from step 1 against this review and writes only Argus's *misses* to `.argus/memory.jsonl`; its own unconfirmed findings are deliberately not reinforced. Severities come from committed `argus.config.json` (critical + major). **Call it with the default `dry_run: false`** — that is the call that writes; `dry_run: true` previews and writes nothing, so a run that only ever previews learns nothing. Ingest before fixing — a later round reviews different code and cannot score this one.
8. Fix test-first, run 8e's *gate* on the fix diff — sensitivity check and test-value pass — but neither 8e's `argus_review`, which step 1 is about to run on the committed SHA where it can actually be joined, nor 8e's push, which belongs at step 9. Commit, then **go back to step 1** — `argus_review` on the *fix* commit before requesting the next CodeRabbit review. Skipping it leaves that round with no SHA to join on, so step 7 silently scores nothing. Repeat until the counts are zero.
9. **Push before Section 5** (*Merge request to main*, not step 5 above). `glab mr create` builds the MR from the *remote* branch, so fix commits left unpushed are silently absent from it.

`coderabbit.agentType: "Claude Code Extension"` routes **Fix with AI** into this session, but decide convergence from the stored record — a handoff proves findings arrived, never that none remain.

IDE reviews are their own rate pool — **1/hr on the OSS plan**, so a multi-round story waits hours. Under `/loop` that is the cadence; do not spin.

Confirmed on the first run: the extension honours repo `.coderabbit.yaml` `path_filters` (all three unfiltered files were reviewed, none excluded).

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

### 7 — Pipeline on the MR head

`glab api "projects/{enc}/merge_requests/{iid}"` → `head_pipeline.status`, confirming `sha` matches your head; jobs via `.../pipelines/{id}/jobs`. On failure read the log, fix, push, return here. Three failures on one cause → STOP.

`verify:database` runs only when `WATCHDOG_WRITER_DATABASE_URL` and `WATCHDOG_READER_DATABASE_URL` are set as protected masked CI variables; otherwise the DB tests skip in CI — say so rather than implying coverage.

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

Converged = pipeline green AND every finding **fixed** (push → new head → back to 8a), **skipped** with a reason on its thread, or **resolved by CodeRabbit**. Anything else is pending — including a review still missing after the wait.

**8d. Triage.** Fix real correctness/security/accessibility issues. **Verify factual claims first** — read the installed types, run the probe, grep the config; CodeRabbit correctly caught that `requestTimeout` doesn't bound socket idleness, and in the same round wrongly asserted the repo runs markdownlint. Skip low-value nits with a written reason, preferably recorded in the code or migration itself.

**8e. Apply — one commit and one push per round.** Fix **every** finding in the round first, then **run the review gate on the whole round's diff before pushing** — sensitivity check, **test-value pass**, and one `argus_review` scoped to what the round touched (`_bmad/custom/review-gate.md`). Then **one** commit, **one** push.

**A push does not reliably trigger a review, and batching does not change that.** CodeRabbit pauses automatic reviews after `auto_pause_after_reviewed_commits` (set to 25 here, default 5), and a paused branch stays paused until asked. So after every push: **confirm a review body exists for the current head**; if none arrives, post `@coderabbitai review` and wait for it. A pause is indistinguishable from a clean review from the outside — which is the false-clean 8c exists to refuse.

**Not a commit per finding.** Story 1.6b answered 4 rounds with 12 commits, and each one cost a re-review, a pipeline and a place in CodeRabbit's `auto_pause_after_reviewed_commits` budget — it paused itself mid-story twice, which from outside is indistinguishable from a clean review. Batching also gives the reviewer the round as one diff, which is how a fix that breaks a sibling fix becomes visible; on 1.6b two such defects were found only because something looked at the fix diff whole.

Keep the reasoning that would have gone in several messages — write it as sections of one commit body rather than losing it.

The test-value pass matters most *here*, because a fix diff is where a test's premise expires. `python3 _bmad/scripts/tests_touched.py <range>` lists the cases the fix touched; for each, ask whether it is **vacuous** (break the code — does it fail?) and whether its premise is **expired** (does it assert something a later decision made wrong?). A mutation finds the first and is blind to the second: an expired test fails loudly when you break the code, so it looks healthy. Story 1.5d shipped two, each blocking the fix it should have driven. Then check what *lost* cover — re-specifying a test can strip the only assertion from a behaviour that is still correct, and the suite goes greener, so nothing complains.

**A fix is the highest-risk diff in the story, not the lowest.** On story 1.5d, rounds 2 and 3 produced **8 findings and every one was in a fix from a previous round** — a swallowed 404, a stale read that reintroduced the bug it was fixing, a `NULL` token written against a check constraint. Fixes are written under time pressure, against a narrower model, on machinery with invariants already in place. Skipping the gate here is skipping it where it pays most.

**8f. Reply per thread** — Fixed (what changed) or Skipped (why). **Write bodies to files** and post with `--field "body=$(cat file)"`.

**Caps:** ~3–4 rounds; only-already-skipped findings recurring counts as converged. On a rate limit, back off ~2400s and re-request rather than pushing.

### 9 — Ready-to-merge (terminal)

1. **Docs first.** Story `Status: done`, Change Log entry, `development_status[{story_key}] = done` + `last_updated`. If this is the epic's last not-`done` story also set `epic-{N} = done` in the same commit; otherwise set it `in-progress` if unset. Commit and push.
2. **Re-verify on the new head.** That push invalidated the Step 7/8 evidence. Re-run Step 7, then Step 8 **including 8a's wait** — a docs-only push triggers a re-review like any other.
3. **If that re-verification fails, undo the status before stopping.** Restore the story to `Status: review`, restore `development_status[{story_key}]` and any `epic-{N}` change, commit and push, then STOP with the failure. A story left reading `done` on a red head both breaks the hard rule above and makes `bmad-implement-epic` skip it, since the loop iterates only over not-`done` stories.
4. **Confirm the MR is still open at your head**, as in 8a, before reporting.
5. Report MR URL, review outcome, pipeline status on the **final** head, and **"Ready to merge — leaving the merge to you."**
6. STOP.

**`done` means ready-to-merge, not merged** — it is written on an unmerged branch. Nothing downstream may treat it as proof of a merge.

## Stacking (exception, on request only)

If the user wants to keep building without merging, branch off the previous *story* branch and say in the MR description that the diff includes the parent. Default is to wait — stacking reintroduces the reviewability problem this design removes.

## Driving with /loop

`/loop ship story {id}`. Early ticks run 1–7 once; later ticks sit in Step 8; the loop ends at Step 9.

Cadence is 8a's waits, scheduled not polled: ~1200s after opening, ~270s after a fix push, ~2400s after a rate limit. Bounded `until` loops are for pipelines, which finish in a minute or two; a foreground `sleep` is blocked. Standalone: run 0–7, STOP at 8a, say when the review is due.

## Project facts

- **"Tested" = `npm run lint` + `npm run build` + `npm test`**, plus `npm run test:db` for schema/adapter work, plus `pytest` once the Python service exists. **Neither ESLint nor Vitest type-checks** — `npm run build` is the only gate that does, and it has caught real errors twice that the other two passed.
- **Python is in scope** — `python3` is installed and the PRD puts a CrewAI service in the architecture.
- **Status flow:** `backlog → ready-for-dev → in-progress → review → done`. `baseline_commit` defines the review diff range.
- **CodeRabbit:** `.coderabbit.yaml`, `auto_review.base_branches: [main]`. Pro is free on public repos and the tier binds at MR-open time. Posts as a service account, findings in the review body, resolves threads itself when satisfied, hourly rate limits.
- **Invariants a review must not trade away:** NFR-2/AD-2 (no banking, payment-rail, or external-accounting credential anywhere, enforced by `core/security/nfr2-guard.test.ts`); AD-4 (reader role is SELECT-only); AD-13 (content-hash idempotency is a DB constraint); `core/` imports nothing outward (`core/ports/boundary.test.ts`). A finding asking you to weaken one is an architecture decision for the user, not a fix.
- **Committed:** `_bmad-output/`. **Ignored:** `.claude/` except tracked skills, `.agents/`, `_bmad/`, `node_modules/`, `.next/`, `.probe/`, `envprobe`, `.env*.local`. Benign: Git's CRLF warnings.
- **Shell gotchas:** backticks inside double-quoted bash strings are command-substituted (write bodies to files); `glab api --field "body=$(cat f)"` **fails if the body starts with `@`** — glab reads a leading `@` as a filename, so every `@coderabbitai review` request errors with "The filename, directory name, or volume label syntax is incorrect"; use `glab mr note create` for those; PowerShell here-strings don't work in the Bash tool; `git show origin/branch:path` is mangled by Windows path conversion (use `git cat-file -p <blob>`); run one test file with `npm test -- <substring>`, never `npx vitest run` (fails here, and `npx` fetches unpinned packages); never `npx prettier` — no config, and its defaults fight the house style.
