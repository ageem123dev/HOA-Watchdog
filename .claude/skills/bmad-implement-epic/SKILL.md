---
name: bmad-implement-epic
description: 'Implement an entire epic story-by-story on isolated per-story branches, merging each completed story into the epic branch, then open ONE PR to main and run the CodeRabbit review loop to convergence. Batches the whole epic into a single PR / single cloud-review cycle — avoids per-story PRs to main and CodeRabbit rate limits. Use when the user says "implement epic N", "ship epic N", or "run epic N".'
---

# Implement Epic Pipeline

**Goal:** Deliver a whole epic as **one** PR. Implement each story in isolation (branch off the epic branch → create + dev + local review → merge back into the epic branch), and only once **every** story is complete open a single PR to `main` and run the CodeRabbit review loop to convergence.

**Why this exists:** Opening a PR to `main` after every story (the `bmad-ship-story` flow) triggers a CodeRabbit review per story — which spams reviews, repeatedly merges `main`, and hits CodeRabbit's **hourly rate limit**. Batching at the epic level means **one epic = one PR = one cloud-review cycle**.

**Reuses:** `bmad-create-story` + `bmad-dev-tdd` (per story), the local `code-review` skill (per story, no PR comment), and the CodeRabbit review loop defined in `bmad-ship-story` Step 8 (once, on the epic PR).

**Implementation is test-first.** The dev step is **`bmad-dev-tdd`**, not `bmad-dev-story` — every behavior gets a failure-mode analysis and failing tests before production code. `bmad-dev-story` is not used here.

## Hard rules

- **NEVER merge the epic PR** and never push to `main`. Terminal state is "ready-to-merge"; the user merges.
- **No per-story PRs to `main`** and **no CodeRabbit during story implementation** — CodeRabbit only auto-reviews PRs to `main` (`.coderabbit.yaml`), so as long as no epic PR is open, story work doesn't consume reviews.
- **NEVER commit secrets** (`.env*.local` stay gitignored). **`gh`** for all GitHub ops. Quote real CI/PR/tool output; never fake completion.
- **Never weaken, skip, or delete a test** to get a green suite, a green merge, or a green CI — fix the code, or STOP with the conflict stated. Applies to review fixes and merge-conflict resolution too, not just the dev step.
- Per-story "done" here means **implemented test-first + locally reviewed + lint/build/test clean + merged into the epic branch**. The cloud (CodeRabbit) review happens once, at the epic PR.

## Inputs

- Epic number (e.g. `2`, `epic 2`). If omitted, infer the single `in-progress` epic from `sprint-status.yaml`; if ambiguous, ask.

## Workflow

### Step 0 — Preflight
`gh auth status` (stop if unauthenticated), `git` available, resolve default branch (`git symbolic-ref refs/remotes/origin/HEAD`, fallback `main`). Read `_bmad-output/implementation-artifacts/sprint-status.yaml` fully.

### Step 1 — Resolve the epic and its stories
From `development_status`, collect `epic-{N}` and all its `{N}-{M}-*` story keys **in order**. Note which are `done` vs not. If all stories are already `done`: if no epic PR exists yet, skip to Step 4; otherwise report the epic is complete and go to Step 5/6. Set `epic_branch = epic-{N}`.

### Step 2 — Epic branch
- `git checkout {default_branch} && git pull --ff-only` to get the latest main.
- If `epic-{N}` doesn't exist: `git checkout -b epic-{N}`. If it exists: check it out and bring it up to date with main if it's behind (merge `main` in).
- Mark `epic-{N}` `in-progress` in `sprint-status.yaml` if not already.

### Step 3 — Per-story loop (for each not-done story, in order)
1. **Branch off the epic branch:** `git checkout epic-{N}` then `git checkout -b story/{story_key}` (check it out if it already exists).
2. **Create the story** if its status is `backlog`: invoke **`bmad-create-story`** for `{story_id}` (writes the story file, status → `ready-for-dev`).
3. **Implement test-first:** invoke **`bmad-dev-tdd`** for `{story_key}` — failure-mode analysis → red → green → refactor/harden per task, fills the Dev Agent Record (incl. Test Design), status → `review`. Then run `npm run lint` + `npm run build` + `npm test`. Wiring notes:
   - **Test harness (its Step 2):** if none exists yet **for the language the story touches**, it stops to ask. **Approve the conventional harness for that stack rather than stalling** — **Vitest** for the Next.js/TypeScript side (`npm i -D vitest` + `"test": "vitest run"`; add `@testing-library/react` + `jsdom` only when a story needs component tests), **pytest** for the Python service. Take its own proposal if it fits the stack better. The story that first adds a runner **must also add its test command to `.github/workflows/ci.yml`** — the epic-branch push in step 8 below is the integration gate and is worthless if tests don't run there.
   - **Pass `story_path` = the story file explicitly** so its story-discovery menu never fires under `/loop`.
   - **Customization resolver:** run `python3 {project-root}/_bmad/scripts/resolve_customization.py` as its Step 1 and Step 11 instruct — Python 3.14 and the script are both present. Hand-merge the TOML (base → `_bmad/custom/bmad-dev-tdd.toml` → `.user.toml`) only if the script actually errors.
   - **A HALT is a real halt** (ambiguous AC, untestable design, test/code conflict): surface it and STOP the epic loop — do not skip the story and move on.
4. **Local review:** run the local **`code-review`** skill scoped to the story's `baseline_commit..HEAD`. Fix CONFIRMED/PLAUSIBLE findings **test-first** — reproduce with a failing test, then fix (or skip a nit with a one-line reason in the Dev Agent Record). Re-run lint + build + test. (No PR exists, so this review is local only — do not post PR comments.)
5. **Commit** the implementation + any review fixes on `story/{story_key}`.
6. **Merge into the epic branch:** `git checkout epic-{N}` then `git merge --no-ff story/{story_key} -m "Merge story {story_id}: {title} into epic-{N}"`. Resolve conflicts if any (sequential stories on a shared base rarely conflict). Optionally delete the story branch: `git branch -d story/{story_key}`.
7. **Mark the story `done`** in `sprint-status.yaml` (implemented + integrated).
8. **Push the epic branch** (`git push -u origin epic-{N}`). This runs **CI** on the accumulated epic branch (catches integration breaks early) but triggers **no CodeRabbit** (no PR to `main` yet). If CI fails, fix on the epic branch before the next story. Then return to the top of Step 3 for the next story.

### Step 4 — Open the single epic PR
When every story is `done` and merged: ensure `epic-{N}` is pushed, then `gh pr create --base {default_branch} --head epic-{N} --title "Epic {N}: <epic name>" --body "<one section per story: statement + key ACs + verification>"`. This is the **only** PR for the epic and the **only** thing CodeRabbit reviews. Record `pr_number`/`pr_url`, report it.

### Step 5 — CodeRabbit review loop (once, on the epic PR)
Run the loop exactly as **`bmad-ship-story` Step 8**:
- Read the latest CodeRabbit **review body** (`Actionable comments posted: N`) for the current PR head (not just inline-comment counts); convergence = no new actionable findings for the current head + CI green.
- Triage: fix real correctness/security findings (minimal changes, **test-first** — a failing regression test before the fix); skip unenforced nits with a documented reason. Apply on the **epic branch** directly (not the merged story branches), re-run lint + build + test, commit, `git push` (auto-triggers re-review), reply to `@coderabbitai` with Fixed/Skipped per finding. Repeat.
- **Anti-churn cap** ~3–4 rounds; if only already-skipped nits recur, treat as converged.
- **Rate-limit handling:** if CodeRabbit reports a review/rate limit (or posts only a summary with no review), **back off ~40 min** (`ScheduleWakeup` ~2400s) and then re-request `@coderabbitai full review` — do not spin or keep pushing. A single epic PR makes this rare.

### Step 6 — Ready-to-merge (terminal)
When CI is green and CodeRabbit has no open actionable findings: mark `epic-{N}` `done` in `sprint-status.yaml` (+ `last_updated`), commit/push the doc update, and report the PR URL + review outcome + the line **"Ready to merge — leaving the merge to you."** STOP. Do not merge.

## Driving with /loop

Run the whole epic under `/loop` (dynamic mode): `/loop implement epic {N}`. Early ticks implement stories (Step 3) — these are local/fast, so short cadence is fine; once the epic PR is open (Steps 5), waits on CodeRabbit, so lean ~1200–1800s, and **~2400s (40 min) after a rate-limit**. The loop ends itself at Step 6 (omit the next `ScheduleWakeup`).

## Project learnings baked in (PayUp)

- **`gh`** required for GitHub ops. **Python is available and in scope** — `python3` (3.14) is installed and `_bmad/scripts/resolve_customization.py` runs, so invoke sub-skill resolvers directly; and the PRD puts a **Python service in the target architecture** (the CrewAI microservice behind the Node gateway, `docs/prd/prd.md` §6.1), so stories that add Python code or tests are expected, not out of bounds.
- **"Tested" = `npm run lint` + `npm run build` + `npm test` clean** on the Node/Next side, plus **`pytest`** once a story introduces the Python service. This project develops test-first (`bmad-dev-tdd`), so a real runner is expected in each language — **Vitest** on the JS side unless a story establishes otherwise. Keep it dependency-light: one runner per language, helper libraries only when a story needs them. "Green" means every configured gate, across both stacks.
- **CodeRabbit:** full Pro reviews are free on **public** repos but the **plan tier binds at PR-open time** (open the epic PR while the repo is public). Findings live in the **review body** (`Actionable comments posted: N`). It has **hourly rate limits** — back off and re-request rather than spamming.
- **`/canary` must stay un-gated** (Story 1.2 invariant) across all epics.
- **Supabase client env guard:** wiring the client into a build-evaluated route makes `next build` require `NEXT_PUBLIC_SUPABASE_*`; CI build provides placeholders (see `ci.yml`). DB migrations are applied manually in Supabase (deploy-time), not by CI.
- **`_bmad-output/` is committed**; `.claude/` (except tracked skills), `.agents/`, `_bmad/`, `node_modules/`, `.next/`, `.env*.local` are gitignored. Benign noise: Git CRLF warnings, the Node-20 GitHub-Actions deprecation annotation.
