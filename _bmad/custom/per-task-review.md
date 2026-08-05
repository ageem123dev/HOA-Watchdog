# Per-task review contract

Authoritative rule for what must run **after every task** in `bmad-dev-tdd`, not only at the end of a
story.

Loaded as a persistent fact by `_bmad/custom/bmad-dev-tdd.toml`, so it survives BMad reinstalls that
overwrite `.claude/skills/bmad-dev-tdd/`. The step file carries a short pointer; **this file wins**
if they ever disagree.

---

## 1. Two checks, not one, and they are not interchangeable

Story 1.5d is the reason this file exists. Its four tasks ran 29 mutations and 28 were detected, which
looked like thorough verification. A local review afterwards found **four more defects**, one of
which was user-visible and serious: a document that had been read successfully reported "Reading" to
the treasurer on every later poll, forever.

The two checks answer different questions and neither substitutes for the other:

| Check | Question it answers | What it is blind to |
| --- | --- | --- |
| **Sensitivity (mutation)** | Would my tests notice if this line changed? | A branch, a case or a concern no test was ever written for |
| **Adversarial review** | What did I not think about? | Anything outside the diff it was given |

Mutation testing only probes where a test already exists. It cannot ask about a distinction never
drawn — which is precisely how the 1.5d defect survived: `claimForExtraction` returned `null` for two
different situations and both were treated as one, so there was no assertion to mutate.

**Run both. After every task. Before the task's checkbox is ticked.**

## 2. Order

1. Task reaches green and the full suite passes.
2. **Sensitivity check** — break the task's load-bearing assertion, confirm the test fails, restore,
   re-run. Existing `bmad-dev-tdd` Step 9 behaviour.
3. **Adversarial review** — one `argus_review` call scoped to *this task's* diff.
4. Verify every finding against the real files (`argus-review-routing.md` §5 — mandatory).
5. Fix confirmed findings **test-first**: a regression test that fails against the pre-fix code.
6. Only then tick the checkbox.

A task is not complete because its tests pass. It is complete when both checks have run and what they
found has been fixed or recorded.

## 3. Scoping the per-task call

`argus_review` costs ~10–18k input tokens of scaffolding per call before it reads anything, so the
scope must be the task's own change, not the story's accumulated diff:

```
diff = git diff <commit-at-task-start>..HEAD -- <paths this task touched>
```

Capture the SHA at the start of each task. If the task is not yet committed, `git diff HEAD` over its
paths is the same scope.

Everything else follows `argus-review-routing.md` unchanged: `repo_root` is mandatory and absolute,
pass `diff`/`diff_file` rather than `git_range`, one call per scope, never one per file.

**Exclude story and planning documents.** They are the review's *spec*, loaded separately; reviewing
them as a diff is reviewing the prose against itself.

## 4. When a task's diff is trivial

Skip the review call — and say so — when the task changed only:

- documentation, comments or story files
- test fixtures with no production change
- fewer than ~20 lines with no new branch, no new state and no new external call

Say which of these applied. A skipped check that is never mentioned reads exactly like a check that
passed, which is the failure mode this whole file exists to prevent.

## 5. The whole-story pass still happens

`bmad-ship-story` Step 6 keeps its review of `baseline_commit..HEAD`. Per-task reviews cannot see
across tasks — an interaction between task 2's schema and task 3's write path is invisible to both
individually. The final pass is the integration pass, and its scope should be stated as such.

## 6. Cost, stated plainly

Roughly one `argus_review` call per task plus one per story. On story 1.5d that would have been five
calls; the single whole-story call it did run cost ~392k tokens. Budget accordingly, and prefer
`provider: "offline"` when the point is to test wiring rather than to get findings.

If cost forces a choice, keep the **per-task** reviews. They catch defects while the task is still in
mind and before later work is built on top of them, which is worth more than the integration pass.
