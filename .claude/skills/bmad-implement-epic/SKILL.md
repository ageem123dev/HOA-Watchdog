---
name: bmad-implement-epic
description: 'Implement an entire epic by running bmad-ship-story once per story, in order — each story gets its own branch, its own merge request to main, and its own CodeRabbit review cycle. Use when the user says "implement epic N", "ship epic N", or "run epic N".'
---

# Implement Epic Pipeline

**Goal:** Deliver a whole epic, one story at a time, by looping **`bmad-ship-story`** over the epic's stories in order.

**This skill is a loop, not a second pipeline.** It owns: which epic, which stories, what order, when to stop, and the handoff between stories. Everything about *shipping* a story — branch, create, implement test-first, local review, MR, pipeline, CodeRabbit loop, ready-to-merge — belongs to `bmad-ship-story` and is not restated here. If the two ever disagree, `bmad-ship-story` wins.

**Why it works this way.** An earlier version batched every story in an epic onto one branch and opened a single epic MR, to avoid per-story CodeRabbit reviews and their hourly rate limit. That trade stopped paying: stories in this project are large enough that one is already a substantial review, and an epic-sized diff is one nobody can read carefully. Review quality is the thing being bought here, and it degrades fast with diff size. Fewer, bigger stories also means fewer MRs, so the rate limit that motivated batching is much less pressing.

## Hard rules

- **NEVER merge an MR** and never push to `main`. Each story's terminal state is "ready-to-merge"; the user merges.
- **One story = one branch = one MR to `main` = one review cycle.** Never combine stories into a single MR.
- **A story is `done` only when its MR is ready-to-merge** — implemented test-first, locally reviewed, lint/build/test clean, pipeline green, and no open actionable review feedback.
- **Never weaken, skip, or delete a test** to get a green suite, a green pipeline, or a clean review. Fix the code, or STOP with the conflict stated.
- **A HALT inside a story halts the epic.** Do not skip a blocked story and move to the next one — the next story is usually built on it, and the blockage compounds silently.
- **NEVER commit secrets** (`.env*.local` stay gitignored). Quote real pipeline/MR output; never fake completion.

## Inputs

- Epic number (e.g. `2`, `epic 2`). If omitted, infer the single `in-progress` epic from `sprint-status.yaml`; if that is ambiguous, ask.

## Workflow

### Step 0 — Preflight

`glab auth status` (STOP if unauthenticated), `git` available, default branch is `main`. Read `_bmad-output/implementation-artifacts/sprint-status.yaml` fully, top to bottom — the order of `development_status` is the story order.

### Step 1 — Resolve the epic and its stories

From `development_status`, collect `epic-{N}` and all its `{N}-{M}-*` story keys **in order**. Record which are `done`. Mark `epic-{N}` as `in-progress` if it is not already.

If every story is already `done`, go to Step 4.

### Step 2 — The loop

For each not-`done` story, **in order**:

1. **Sync:** `git checkout main && git pull --ff-only`.

2. **Check the previous story actually landed.** If the previous story in this epic is marked `done` but its work is not in `main`, its MR is still open and awaiting the user's merge. **STOP and report**: name the open MR, say the epic is paused on that merge, and say that re-running this skill resumes from here. This is a user gate, not a failure — do not work around it.

   Do not branch the next story off the unmerged one. That puts the parent's whole diff inside the child's MR, which is the reviewability problem this pipeline exists to avoid. (`bmad-ship-story` documents stacking as an explicit, user-requested exception.)

3. **Ship it:** invoke **`bmad-ship-story`** with this story's id. It runs its own Steps 0–9 and terminates at ready-to-merge, having marked the story `done` in `sprint-status.yaml`.

4. **Report the MR** and continue to the next story at Step 2.1.

If `bmad-ship-story` HALTs or STOPs for any reason other than reaching ready-to-merge, surface that and stop the epic there.

### Step 3 — Between stories

Each iteration starts from a freshly pulled `main`, so a story picks up every previously merged story. Nothing accumulates on a long-lived epic branch, and there is no epic-level merge step — there is nothing to integrate, because each story integrated itself when its MR merged.

There is no `epic-{N}` branch in this design. If one exists from an earlier run, leave it alone; do not build on it.

### Step 4 — Epic complete (terminal)

When every story is `done` and merged into `main`:

1. Set `epic-{N}` to `done` in `sprint-status.yaml` (+ `last_updated`). Commit and push that doc update on a small branch with its own MR, or fold it into the last story's MR — **not** by pushing to `main`.
2. Report: every story with its MR URL and review outcome, and the confirmation that `main` contains them all.
3. If the epic has a `epic-{N}-retrospective` entry, mention that `bmad-retrospective` is available. Do not run it unasked.
4. STOP.

## Driving with /loop

`/loop implement epic {N}` (dynamic mode).

Cadence follows whatever phase the current story is in, because the wait is always inside `bmad-ship-story`:

- Story being created or implemented — local and fast; short ticks are fine.
- Waiting on a first CodeRabbit review — ~1200–1800s.
- Just pushed a review fix — ~270s.
- Rate-limited — ~2400s.
- **Paused on a user merge (Step 2.2)** — this is the one wait a tick cannot resolve. Stop the loop and report rather than waking repeatedly to find the same unmerged MR. The user restarts it after merging.

The loop ends itself at Step 4.

## What this skill does not do

- It does not implement anything. If you find yourself writing production code here, you are in the wrong skill — that is `bmad-dev-tdd`, via `bmad-ship-story`.
- It does not run reviews. Local review is `bmad-code-review`; cloud review is CodeRabbit. Both are driven by `bmad-ship-story`.
- It does not merge, and it does not decide that a story is good enough. Those are the user's.

## Project learnings baked in (HOA Treasurer Assistant)

Everything about the toolchain, the gates, the CodeRabbit specifics, and the architecture invariants lives in **`bmad-ship-story`** — read its *Project learnings baked in* section rather than duplicating it here, because a duplicated list is one that drifts. The epic-level points:

- **Stories here are big.** Story 1.4 was six tasks, 30 files, ~3,900 lines, and 166 new tests, and it drew 17 actionable review findings on its first pass — two of which were defects that made a stated guarantee untrue. That size is the reason for one MR per story; do not batch.
- **Order matters and dependencies are real.** Epic 1's stories build directly on each other — schema, then ingestion, then extraction. A story that starts before its predecessor is in `main` either misses that work or drags it into its own MR.
- **The epic is not done when the code is written.** It is done when every story's MR is merged. Marking `epic-{N}` `done` while an MR is open is the same class of error as marking a story `done` on unverified work.
