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

### 5 — Merge request to main

1. Existing? `glab api "projects/{enc}/merge_requests?source_branch={branch}&state=opened&target_branch=main"`. Filter on the target: an open MR from this branch to anything else must **stop the run** — it gets no CodeRabbit review (see 3), and opening a second MR from the same source is worse. Report it and let the user close or retarget it.
2. Else write the description to a scratch file `{description_file}` and run `glab mr create --source-branch {branch} --target-branch main --title "{story_id}: {title}" --description "$(cat {description_file})" --yes`. **The body must come from a file** — backticks in a double-quoted bash string get command-substituted. `{description_file}` is a scratch path you choose, not `story_file` and not a literal `file`.
3. **Must target `main`.** `.coderabbit.yaml` sets `auto_review.base_branches: [main]`; any other target gets no review at all.
4. Record `mr_iid`/`mr_url`, report the URL, and write `merge_request: {mr_iid}` into the story frontmatter — the epic loop uses it to verify the merge rather than trusting a status word.

### 6 — Local adversarial review (once per new code state)

Invoke **`bmad-code-review`** (not the lighter built-in `code-review`) on `baseline_commit..HEAD` (fallback `main...HEAD`), passing `story_file` as the spec for **`full`** mode. It writes to the story's `### Review Findings` — the audit trail.

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

Two shapes will fool a naive match, in opposite directions:

- The **summary comment** (`<!-- … summarize by coderabbit.ai -->`) arrives within a minute and carries no findings — a note that is not a review.
- An **incremental re-review** that finds only repeats posts `Duplicate comments (N)` with **no** `Actionable comments posted:` line — a review that does not look like one. Match either header, and read a note carrying `Outside diff range comments (N)` too: those are findings that could not be posted inline.

**8c. Convergence.** Precondition: a service-account review matching the current head. Without it nothing below applies — "zero unresolved threads" and "no review yet" are both true *before* any review, so a predicate lacking this precondition reports a never-reviewed story clean. An earlier version of this file did.

Converged = pipeline green AND every finding **fixed** (push → new head → back to 8a), **skipped** with a reason on its thread, or **resolved by CodeRabbit**. Anything else is pending — including a review still missing after the wait.

**8d. Triage.** Fix real correctness/security/accessibility issues. **Verify factual claims first** — read the installed types, run the probe, grep the config; CodeRabbit correctly caught that `requestTimeout` doesn't bound socket idleness, and in the same round wrongly asserted the repo runs markdownlint. Skip low-value nits with a written reason, preferably recorded in the code or migration itself.

**8e. Apply.** Fix test-first, re-run lint+build+test, commit, push (auto-triggers re-review; force with `@coderabbitai review`).

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
- **Shell gotchas:** backticks inside double-quoted bash strings are command-substituted (write bodies to files); PowerShell here-strings don't work in the Bash tool; `git show origin/branch:path` is mangled by Windows path conversion (use `git cat-file -p <blob>`); run one test file with `npm test -- <substring>`, never `npx vitest run` (fails here, and `npx` fetches unpinned packages); never `npx prettier` — no config, and its defaults fight the house style.
