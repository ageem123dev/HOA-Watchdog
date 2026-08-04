---
name: bmad-ship-story
description: 'Run a single story end-to-end on its own branch: create it, implement it test-first, review it locally, open a merge request to main, and run the CodeRabbit loop until the MR is clean and ready-to-merge. Use when the user says "ship a story", "ship the next story", "run the story pipeline", or "ship story <id>". Designed to be driven by /loop for the review-watch phase, and to be called in a loop by bmad-implement-epic.'
---

# Ship Story Pipeline

**Goal:** Take one story from idea to a green, reviewed, ready-to-merge merge request — on **its own branch**, with **its own CodeRabbit review cycle**.

**Your Role:** Delivery driver. You orchestrate the BMad skills (`bmad-create-story`, `bmad-dev-tdd`, `bmad-code-review`) plus GitLab, and you own the implement↔review loop until the MR has no open actionable feedback and CI is green. Then you STOP — you do not merge.

**One story = one branch = one MR = one review cycle.** This is deliberate. Stories in this project are large enough that a single story is a substantial review on its own; batching several into one MR produces a diff nobody can review carefully, and the review that matters most — the one that catches a guard that proves nothing — is the one a reviewer can still hold in their head.

**Implementation is test-first.** The dev step is **`bmad-dev-tdd`**, not `bmad-dev-story` — every behavior gets a failure-mode analysis and failing tests before production code. `bmad-dev-story` is not used here.

This skill is a **resumable state machine**. Every run detects the current state from `sprint-status.yaml`, git, and the MR, then advances as far as it can. It is safe to re-run; it never repeats a completed phase. The review-watch phase (Step 8) is meant to be driven by `/loop` so feedback gets picked up on each tick.

## Conventions

- `{project-root}` is the repo working directory.
- `implementation_artifacts` = `{project-root}/_bmad-output/implementation-artifacts`
- `sprint_status` = `{implementation_artifacts}/sprint-status.yaml`
- `story_file` = `{implementation_artifacts}/{story_key}.md`
- **This project is GitLab-only.** All remote operations use the **`glab`** CLI. There is no GitHub remote. A leftover `.github/workflows/ci.yml` exists but does not run — **`.gitlab-ci.yml` is the pipeline**.
- Default base branch is `main`. Never guess CI/MR state — query it.

## Hard rules

- **NEVER merge the MR** and never push to `main` directly. Terminal state is "ready-to-merge"; the user merges.
- **NEVER commit secrets.** `.env*.local` are gitignored — keep it that way; never `git add -f` them.
- **NEVER mark a story `done` on unverified work.** `done` requires: all story tasks checked, local `lint` + `build` + `test` clean, pipeline green on the MR head commit, and no unresolved actionable review comments.
- Only edit the story file in the permitted areas (Status, Tasks checkboxes, Dev Agent Record — Debug Log / Test Design / Completion Notes, File List, Change Log, frontmatter `baseline_commit`) — same contract as `bmad-dev-tdd`.
- **Never weaken, skip, or delete a test** to get a green suite or a green pipeline. Fix the code, or STOP and surface the conflict. This applies to local review fixes (Step 6) and CodeRabbit fixes (Step 8) as much as to the dev step.
- Quote real tool/CI/MR output rather than asserting success. If a step fails, surface it and stop; never fake completion.

## Inputs

- Optional: a story identifier (`1.5`, `1-5`, `1-5-read-a-document`) or a story file path. If omitted, auto-discover (Step 1).

## Workflow

### Step 0 — Preflight

1. Confirm `glab auth status` is authenticated and `git` is available. If `glab` is missing from PATH, it is installed at `C:\Users\magee\AppData\Local\Programs\glab\glab.exe` — add that directory to PATH for the shell (`export PATH="$PATH:/c/Users/magee/AppData/Local/Programs/glab"`). If unauthenticated, STOP and tell the user to run `glab auth login`.
2. Read `sprint_status` fully (top to bottom — order matters).
3. Confirm the default branch is `main`.

### Step 1 — Resolve the target story

- **If an argument was given:** parse `epic_num`, `story_num`; resolve `story_key` by matching the `N-M-*` key in `sprint_status` (or use the provided file path).
- **If no argument:** pick the FIRST story key (top-to-bottom) in `development_status` whose status is **not** `done` and is not an `epic-*` / `*-retrospective` key. A story already `in-progress`/`review` is resumed; a `backlog`/`ready-for-dev` story is started.
- If every story is `done`, report that and STOP.
- Set `story_key`, `story_id` (`epic.story`), `story_file`.

### Step 2 — Branch setup: one branch per story

1. `git checkout main && git pull --ff-only` — start from the latest `main`, which contains every previously merged story.
2. If `story/{story_key}` already exists, check it out (resumption). Otherwise `git checkout -b story/{story_key}`.
3. Record it as `work_branch`.

**If `main` does not yet contain the previous story** (its MR is still open), STOP and report. Branching this story off an unmerged parent puts the parent's whole diff into this story's MR, which is precisely the outcome one-story-per-MR exists to prevent. The user merging the previous MR is the gate. See *Stacking, and why it is the exception* below for the deliberate override.

### Step 3 — Create the story (if needed)

- If `development_status[story_key]` is `backlog`, or the story file does not exist: invoke **`bmad-create-story`** for this story. It writes the story file and flips status to `ready-for-dev`.
- If the story file exists and status is `ready-for-dev` or later: skip.

### Step 4 — Implement the story test-first (if needed)

- If status is `ready-for-dev` or `in-progress`: invoke **`bmad-dev-tdd`**, which runs failure-mode analysis → red → green → refactor/harden per task, fills the Dev Agent Record (including the Test Design subsection), and sets status to `review`.
- If status is already `review`/`done`: skip implementation — we are here to review and ship.

**Wiring `bmad-dev-tdd` into this pipeline:**

- **Test harness (its Step 2).** If no harness exists for the language the story touches, it stops to ask. Under `/loop`, approve the conventional harness rather than stalling — **Vitest** for the Next.js/TypeScript side, **pytest** for the Python service. Take its own proposal if it fits better. Only STOP if it wants a heavyweight runtime change the story does not cover.
- **A story that adds a new gate must add it to `.gitlab-ci.yml`.** A gate that only runs on a developer's machine is not a gate.
- **Pass `story_path` = `story_file` explicitly** so its story-discovery menu never fires under `/loop`.
- **Customization resolver:** run `python3 {project-root}/_bmad/scripts/resolve_customization.py` as its Step 1 and Step 11 instruct. Hand-merge the TOML only if the script actually errors.
- **A HALT is a real halt.** Ambiguous acceptance criterion, untestable design, test/code conflict — surface it and STOP. Do not paper over it and continue to the MR.

After it returns, commit and push: `git add -A`, commit with a clear message ending in the `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer, then `git push -u origin {work_branch}`.

### Step 5 — Open (or find) the merge request to main

1. Look for an existing open MR for this branch:
   `glab api "projects/{project_path_encoded}/merge_requests?source_branch={work_branch}&state=opened"`
2. If none, create one:
   `glab mr create --source-branch {work_branch} --target-branch main --title "{story_id}: {story title}" --description "<body>" --yes`
   Build the body from the story's statement, acceptance criteria, the decisions worth arguing with, and a verification line (lint / build / test counts / pipeline). **Long descriptions belong in a file** — write it to the scratchpad and pass `--description "$(cat file)"`; inline shell strings containing backticks get command-substituted by bash.
3. **The MR must target `main`.** `.coderabbit.yaml` sets `auto_review.base_branches: [main]` — an MR to any other branch gets no review at all, which silently removes the entire point of this step.
4. Record `mr_iid`/`mr_url` and report the URL.

### Step 6 — Adversarial local review (once per new code state)

Run whenever the head has code that has not yet had a local review.

**The default reviewer is `bmad-code-review`** (adversarial parallel layers: Blind Hunter + Edge Case Hunter + Acceptance Auditor), not the lighter built-in `code-review`.

1. Review range: `baseline_commit..HEAD` from the story frontmatter (fallback `main...HEAD`).
2. Invoke **`bmad-code-review`** on that range, passing `story_file` as the spec so it runs in **`full`** mode and the Acceptance Auditor checks the diff against the acceptance criteria. It writes findings to the story file's **`### Review Findings`** section — that section is the audit trail.
3. Drive triage to a decision. Under `/loop`, choose **Apply every patch** so the loop does not stall. If it raises a finding that genuinely needs a human call, surface it and STOP rather than guessing.
4. Fix findings **test-first** — a failing test before the fix. A review fix without a regression test is not fixed, only moved. Re-run the gates, commit, push.

**Look hardest at guards that prove nothing.** This project has produced nine of them: a check that reads as protective and passes whether or not the thing it protects against is present. A bare `rejects.toThrow()` that also passes when the table does not exist; a `for` loop over an empty list; a `Promise.all` "concurrency" test that passes against a deliberately racy implementation; a `requestTimeout` that only logs a warning. The sensitivity check in `bmad-dev-tdd` Step 9 is the tool: break the code the assertion covers, confirm the test fails, restore.

### Step 7 — Verify the pipeline on the MR head

1. Find the pipeline for the current head SHA:
   `glab api "projects/{project_path_encoded}/merge_requests/{mr_iid}"` → `head_pipeline.status`, and confirm `sha` matches your pushed head.
2. Inspect jobs: `glab api "projects/{project_path_encoded}/pipelines/{id}/jobs"`.
3. If it fails, read the job log, fix the cause, push, and return here. Three consecutive failures on the same cause → STOP and ask.

Note `verify:database` only runs when `WATCHDOG_WRITER_DATABASE_URL` and `WATCHDOG_READER_DATABASE_URL` are defined as protected, masked CI variables. If they are not set, the database tests **skip in CI** and are proven only locally — say so rather than implying full coverage.

### Step 8 — CodeRabbit review loop (the loop tick)

This is the phase `/loop` re-enters. Keep cycling fix → push → re-review until there is no new actionable feedback.

**8a. Read the latest review — from the review BODY.**

- **CodeRabbit posts under a service-account username** on this project (`service_account_group_138854092_…`), **not** a username containing "coderabbit". Filtering on the name "coderabbit" returns zero matches and looks exactly like "no review yet" — that has already produced one wrong status report on an MR that had 17 findings waiting.
- Fetch: `glab api "projects/{project_path_encoded}/merge_requests/{mr_iid}/notes?per_page=100&sort=desc"`. The authoritative count is the note body containing **`Actionable comments posted: N`**. Inline-comment tallies do not match it.
- Thread IDs for replying come from `.../merge_requests/{mr_iid}/discussions`.
- Only trust a review whose commit matches the **current** head. A review for an older head is stale.

**8b. Detect convergence.** Clean = pipeline green AND one of:

- the newest review for the current head says `Actionable comments posted: 0`; or
- CodeRabbit has **resolved the threads itself** (it does this when satisfied — check `discussions` for unresolved count `0`); or
- a full wake cadence has elapsed since your push with still no review for the current head (use the cadences below, not a vague "wait a bit").

Until then, treat it as *pending*, not converged. Do not mistake a slow or rate-limited review for a clean result.

**8c. Triage — verify each finding, do not apply blindly.**

- **Fix** real correctness, security, and accessibility issues.
- **Check the claim first when it is a factual one.** CodeRabbit is often right and occasionally wrong, and the difference is cheap to establish: read the installed package's types, run the probe script, grep the CI config. In one round it correctly identified that `requestTimeout` does not bound socket idleness (confirmed in `@smithy/types`); in the same round it asserted the repo runs markdownlint, which it does not.
- **Skip** low-value nits the repo does not enforce, and anything whose cost exceeds its benefit at current scale — but **always with a written reason**, and prefer recording that reason *in the code or migration itself* rather than only in a comment thread.

**8d. Apply, validate, push.** Fix **test-first**, re-run lint + build + test, commit, push. The push auto-triggers re-review. (To force one: comment `@coderabbitai review`.)

**8e. Reply per finding, for the audit trail.** Post a reply on **each thread** saying Fixed (with what changed and why) or Skipped (with the reason). Reply bodies containing backticks or code fences **must be written to files and posted with `--field "body=$(cat file)"`** — backticks inside a double-quoted bash string are command-substituted and the call will fail or corrupt.

**Anti-churn guard:** cap at ~3–4 rounds. If a round surfaces only findings already consciously skipped, treat it as converged and move on.

**Rate-limit handling:** if CodeRabbit reports a rate limit or posts only a summary with no review, back off ~40 minutes (`ScheduleWakeup` ~2400s) and re-request. Do not spin or keep pushing.

### Step 9 — Ready-to-merge (terminal)

When the pipeline is green and no actionable feedback is open:

1. Mark the story `done`: `Status: done` in the story file, a Change Log entry summarizing the review outcome, and `development_status[{story_key}] = done` + `last_updated` in `sprint_status`. Commit and push.
2. Report: MR URL, review outcome (rounds and finding counts), pipeline status, and the explicit line **"Ready to merge — leaving the merge to you."**
3. STOP.

## Stacking, and why it is the exception

If the user explicitly wants to keep building without merging the previous story, branch the next story off the previous **story branch** rather than `main`, and say plainly in the MR description that the diff includes the parent story and should be read after it merges. Accept this only on request. The default is to wait, because a stacked MR reintroduces exactly the reviewability problem that one-story-per-MR exists to solve.

## Driving with /loop

- `/loop ship story {story_id}` (dynamic mode). Early ticks run Steps 1–7 once; later ticks sit in Step 8; the loop ends itself at Step 9 (omit the next `ScheduleWakeup`).
- **Cadence:** a first review on a new MR can take 10–20+ minutes; re-reviews after a push are usually faster. After opening an MR, a ~1200–1800s heartbeat; right after pushing a fix, ~270s. After a rate-limit, ~2400s. Do not long-foreground-poll — check on wake ticks. Bounded `until` loops are fine; a foreground `sleep` is blocked by the harness.
- **Standalone (no loop):** run Steps 0–7 to completion and do ONE Step 8 check, then report "MR open and green; awaiting CodeRabbit".

## Project learnings baked in (HOA Treasurer Assistant)

- **GitLab only.** `glab` for every remote operation; MRs, not PRs; `.gitlab-ci.yml`, not the vestigial `.github/workflows/ci.yml`. The project path is `ageem123/hoa-treasurer-assistant` (URL-encode as `ageem123%2Fhoa-treasurer-assistant` for `glab api`).
- **"Tested" = `npm run lint` + `npm run build` + `npm test` clean**, plus `npm run test:db` when the story touches the schema or an adapter, plus `pytest` once the Python service exists. **Neither ESLint nor Vitest type-checks** — `npm run build` is the only gate that does, and it has caught real errors twice that the other two passed. "Tests green, lint green" is not "compiles".
- **Python is in scope.** `python3` is installed and `_bmad/scripts/resolve_customization.py` runs. The PRD puts a CrewAI service in the target architecture, so stories adding Python are expected.
- **Story status flow:** `backlog → ready-for-dev → in-progress → review → done`. The `baseline_commit` frontmatter defines the review diff range.
- **CodeRabbit on GitLab:** configured by `.coderabbit.yaml`, `auto_review.base_branches: [main]`. Full Pro reviews are free on **public** repos and the tier binds at MR-open time. It posts as a **service account**, puts findings in the **review body**, resolves threads itself when satisfied, and has hourly rate limits.
- **Architecture invariants a review must not trade away:** NFR-2 / AD-2 — no banking, payment-rail, or external-accounting credential in any environment, secret store, or CI config; `core/security/nfr2-guard.test.ts` enforces it in the pipeline. AD-4 — the reader role is SELECT-only. AD-13 — content-hash idempotency is a database constraint, not an application check. `core/` imports nothing outward (`core/ports/boundary.test.ts`). If a review finding asks you to weaken one of these, that is an architecture decision for the user, not a fix to apply.
- **`_bmad-output/` is committed.** `.claude/` (except tracked skills), `.agents/`, `_bmad/`, `node_modules/`, `.next/`, `.probe/`, `envprobe`, and `.env*.local` are gitignored. Benign noise: Git's `LF will be replaced by CRLF` warnings.
- **Shell gotchas that have cost real time:** backticks inside double-quoted bash strings are command-substituted (write long bodies to files); PowerShell here-strings do not work in the Bash tool; `git show origin/branch:path` gets mangled by Windows path conversion (use `git cat-file -p <blob>`); `npx vitest run <file>` can fail where `npm test -- <substring>` works; do not run `npx prettier` — the repo has no prettier config and its defaults (double quotes, semicolons) fight the house style.
