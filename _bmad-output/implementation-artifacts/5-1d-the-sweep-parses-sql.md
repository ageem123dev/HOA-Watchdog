---
Status: backlog
baseline_commit:
merge_request:
---

# Story 5.1d: The sweep parses SQL

## Story

As **a board member**,
I want **the guard that proves a catalog query is association-scoped to read the SQL rather than resemble it**,
so that **a query that reads every association's records cannot pass the check that exists to stop it**.

Split from story 5.1c on 2026-08-21, which had itself absorbed this from 5.1b. It shares 5.1c's
theme — a property asserted by resemblance rather than established by construction — and shares
none of its files, which is why it is its own story.

## What is wrong

`catalog/registry.test.ts` decides whether an entry scopes its tables with a hand-written scanner
over the SQL text. Over MR !71 that scanner was defeated **eight times**, each by a different
Postgres lexical form, and two of the fixes introduced defects of their own.

**The sweep is not the proof, and it should not be read as one.**
`adapters/db/catalog-isolation.test.ts` gives two associations the same unit number and runs the
real query; none of the eight bypasses would have survived it. This story makes the early warning
trustworthy — it does not make it the thing that establishes isolation.

## Acceptance Criteria

1. **The sweep reads SQL rather than resembling it.** The hand-written scanner is replaced by a real
   parse — an existing SQL parser, not another hand-written one. Alias resolution is **per query
   scope**, which is the property the current scanner structurally cannot have.

2. **Every bypass found on MR !71 stays a regression case.** All eight, driven through the whole
   sweep and asserting *which* stage rejects them, as the current fixtures already do: a line
   comment, a nested block comment, a plain literal, an `E'…\'…'` escape string, a `$café$` tag, a
   schema-qualified name, a comma-separated list, and an alias shadowed inside a subquery. A parser
   that accepts any of them is not an improvement.

3. **What the parser cannot analyse is still refused, not guessed at.** The one rule that held
   across eight rounds. A construct outside what the parser can resolve turns the suite red rather
   than passing quietly.

## Tasks / Subtasks

- [ ] **Task 1 — Choose and name the parser.** **The dependency is approved in principle (Matt,
      2026-08-21); the specific library is not chosen.** Name it here with its resolution behaviour
      checked against the eight bypasses rather than assumed, and record why it was picked over the
      alternatives. It parses SQL that decides which association's records are returned, so its
      supply chain is part of the decision. (AC1)
- [ ] **Task 2 — Rewrite `sweepVerdict` around the parse.** Per-scope alias resolution replaces the
      flat namespace. Keep the shape that works: one function returning the reason or `null`, called
      by both the per-entry sweep and the fixtures, so the two cannot drift. (AC1)
- [ ] **Task 3 — Carry the eight bypasses over.** Each asserting the stage that rejects it, and each
      proved by mutation rather than assumed. (AC2)
- [ ] **Task 4 — Refuse what the parser cannot resolve, and delete the rules it makes dead.**
      `FORBIDDEN_LEXICAL` currently subsumes the `E'`/`U&'` and dollar-construct entries in
      `UNANALYSABLE` — anything containing `E'` contains `'` and is already refused. That redundancy
      was left in deliberately at the end of 5.1b rather than doing test-only surgery on a ready MR.
      (AC3)

## Dev Notes

### What eight rounds actually taught

Recorded because the next person will be tempted to patch rather than replace.

The scanner was defeated by: a line comment; a **nested** block comment (the regex fix reopened the
hole one level down); a plain string literal; an `E'…\'…'` escape string; a `$café$` dollar tag; a
schema-qualified name; a comma-separated `from` list; and an alias shadowed inside
`exists (select … from assessment as unit …)`, where the predicate belongs to the inner query and
the outer table is unconstrained.

Two further defects were in the *fixes*: one refusal was dead in the pipeline because it ran after
the literal it looked for had already been blanked, and the bypass fixtures passed for the wrong
reason twice — once because blanking a literal also ate the `from unit` after it, once because every
fixture stopped at the first stage and never reached the one under test.

**The pattern is that a text scan cannot decide a question about what SQL executes.** What ended
each round was not a better regex but the same inversion: *refuse what cannot be analysed*. Keep
that rule after the parser lands (AC9) — a parser has its own edges, and the failure mode to avoid
is the parser silently resolving something differently from Postgres.

**And keep the division of labour honest.** `adapters/db/catalog-isolation.test.ts` gives two
associations the same unit number and runs the real query; none of the eight bypasses would have
survived it. The sweep is an early warning that a *new* entry looks unscoped. It is not the proof,
and 5.1b's own comments now say so.

### Where this sits

Nothing depends on this story, and it depends on nothing. It touches one test file and whatever
dependency task 1 chooses. It is not urgent in the way 5.1c is not urgent — `no-association-creation.test.ts`
forbids the product from creating a second association, so a catalog entry that read across
associations would today read across exactly one.

**What makes it worth doing anyway:** the guard's job is to catch a *new* entry that is unscoped,
and it has been demonstrated eight times that it can be satisfied without scoping anything. A guard
that can be satisfied dishonestly is worse than none, because it is reported as a pass.

### References

- `catalog/registry.test.ts` — the sweep, `sweepVerdict`, and the eight fixtures as they stand
- `adapters/db/catalog-isolation.test.ts` — the behavioural proof this is *not* replacing
- `_bmad-output/implementation-artifacts/5-1b-the-catalog-answers-for-one-association.md` — AC3, and
  the review rounds recorded in its Review Findings
- `_bmad-output/implementation-artifacts/5-1c-the-actor-is-proved-not-relayed.md` — the sibling half

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Split from 5.1c, which had absorbed it from 5.1b. Same theme, no shared files |
