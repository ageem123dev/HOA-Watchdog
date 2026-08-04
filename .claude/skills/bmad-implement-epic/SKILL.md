---
name: bmad-implement-epic
description: 'Implement an entire epic by running bmad-ship-story once per story, in order — each story gets its own branch, its own merge request to main, and its own CodeRabbit review cycle. Use when the user says "implement epic N", "ship epic N", or "run epic N".'
---

# Implement Epic Pipeline

Run **`bmad-ship-story`** once per story, in order.

**This is a loop, not a second pipeline.** It owns which epic, which stories, what order, when to stop, and the handoff between them. Branching, implementation, review, MR, and convergence all belong to `bmad-ship-story`. **If the two disagree, `bmad-ship-story` wins.**

An earlier version batched a whole epic onto one branch behind a single epic MR, to avoid per-story CodeRabbit reviews and their rate limit. Stories here are large enough that one is already a substantial review, and epic-sized diffs cannot be read carefully. Fewer, larger stories also means fewer MRs, so the rate limit matters much less.

## Hard rules

- **Never merge, never push to `main`.** Each story ends ready-to-merge; the user merges.
- **One story = one branch = one MR to `main`.** Never combine stories.
- **Never weaken, skip, or delete a test** to get a green suite, pipeline, or review.
- **A HALT inside a story halts the epic.** Do not skip a blocked story — the next one usually builds on it.
- **Never commit secrets.** Quote real output.

## Workflow

**Input:** epic number. If omitted, infer the single `in-progress` epic; if ambiguous, ask.

### 0 — Preflight

`glab auth status`, `git` available. Read `sprint-status.yaml` fully — the order of `development_status` is the story order.

### 1 — Resolve the epic (read only)

Collect `epic-{N}` and its `{N}-{M}-*` story keys in order; note which are `done`.

**Write nothing here.** There is no branch yet: the next step checks out `main`, so an uncommitted `sprint-status.yaml` edit either blocks that checkout or is swept into the first story's MR by ship-story's `git add -A`. The epic's status is written by `bmad-ship-story` Step 9 inside the story commit that justifies it.

All stories `done` → Step 3.

### 2 — The loop

For each not-`done` story, in order:

1. **Sync:** `git checkout main && git pull --ff-only origin main`. Name the remote — a bare `git pull` follows the configured upstream, and a wrong one reports "Already up to date" while leaving you behind. That has happened here.

2. **Verify the previous story landed — from GitLab and git, not from a status word.** `done` is written on an unmerged branch and means ready-to-merge, not "in `main`". Take `merge_request` from the previous story's frontmatter and assert **both**:
   - `glab api "projects/{enc}/merge_requests/{iid}"` → `state: merged`; and
   - `git merge-base --is-ancestor {merge_commit_sha} origin/main` succeeds.

   The second is not redundant: merged-but-unreachable means you are looking at a different `main` than GitLab is — stale remote, wrong upstream, unfetched ref. That has happened here.

   They fail for different reasons and must not be reported alike:
   - **not merged** → the epic is paused on the user's merge. STOP, name the MR, say re-running resumes from here. A user gate, not a failure.
   - **merged but unreachable** → your local `main` is wrong, not the MR. STOP and say so: fetch, check the branch's upstream. Reporting this as "awaiting merge" sends the user to look at an MR that is already done.

3. **Ship:** invoke **`bmad-ship-story`** with the story id. It runs its own Steps 0–9 and terminates ready-to-merge, having marked the story `done`.

4. Report the MR, continue at 2.1.

Anything other than reaching ready-to-merge → surface it and stop the epic there.

Each iteration starts from a freshly pulled `main`, so there is no epic branch and no integration step — each story integrated itself when its MR merged. If an `epic-{N}` branch exists from an earlier run, leave it alone.

### 3 — Epic complete (terminal)

1. **Require every story MR merged, first.** The loop's 2.2 gate only ever checks the *previous* story, so after the last story ships, nothing has verified its MR. `done` means ready-to-merge, and ship-story writes it — along with `epic-{N} = done` — on the story branch *before* the user merges. Without this check, the epic reports complete while the final MR is still open and `main` does not contain the story.

   For **every** story in the epic, assert `state: merged` and `git merge-base --is-ancestor {merge_commit_sha} origin/main`. Any failure → stop at the user merge gate, exactly as in 2.2 and with the same two diagnoses.

2. **Verify, do not write.** `epic-{N}` should then already read `done`, because ship-story Step 9 sets it inside the last story's commit, landing when that MR merges.

   **There is no epic-level MR.** An earlier version offered "fold it into the last story's MR, or its own" — impossible, since this step only runs after that MR has merged, leaving an epic-only MR to carry a one-line status change. If the status is wrong (interrupted run, hand edit), do not push to `main` and do not open an MR: report it, and let the next story's MR carry the correction, or ask.

3. Report every story with its MR URL and review outcome, and confirm `main` contains them all.
4. Mention `bmad-retrospective` if an `epic-{N}-retrospective` entry exists. Do not run it unasked.
5. STOP.

## Driving with /loop

`/loop implement epic {N}`. Cadence follows the current story's phase, since every wait is inside `bmad-ship-story`: short ticks while implementing, ~1200–1800s awaiting a first review, ~270s after a fix push, ~2400s after a rate limit. **Paused on a user merge (2.2) is the one wait a tick cannot resolve** — stop and report rather than waking to find the same unmerged MR. Ends itself at Step 3.

## Out of scope

It implements nothing (that is `bmad-dev-tdd`, via ship-story), runs no reviews (`bmad-code-review` and CodeRabbit, via ship-story), and neither merges nor judges a story good enough — those are the user's.

## Epic-level facts

Toolchain, gates, CodeRabbit specifics and architecture invariants live in **`bmad-ship-story`** — a duplicated list drifts.

- **Stories here are big.** Story 1.4 was 30 files, ~3,900 lines, 166 new tests, and drew 17 actionable findings on its first pass — two of them defects that made a stated guarantee untrue. That is why one MR per story.
- **Order matters.** Epic 1's stories build directly on each other. A story started before its predecessor is in `main` either misses that work or drags it into its own MR.
- **The epic is done when every MR is merged**, not when the code is written. Marking `epic-{N}` `done` with an MR open is the same error as marking a story `done` on unverified work.
