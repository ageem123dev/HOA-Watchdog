# The review gate

**One rule: every diff that will reach `main` gets all three checks before it is pushed.**

The three are the **sensitivity check**, the **test-value pass** (§2a) and the **adversarial
review**. Each is blind to what the others see, which is why none of them replaces another.

Not "every task" — that was the first version of this file and it was too narrow. There are three
moments where a diff is created, and the rule is the same at all of them:

| Moment | Scope of the checks |
| --- | --- |
| A task completes (`bmad-dev-tdd` Step 9) | that task's own diff |
| A story is ready (`bmad-ship-story` Step 6) | `baseline_commit..HEAD` — the integration pass |
| **A review fix is pushed (`bmad-ship-story` Step 8e)** | **the fix diff** |

The third was missing, and section 1 explains why that turned out to be the worst one to omit.

Loaded as a persistent fact by `_bmad/custom/bmad-dev-tdd.toml`, so it survives BMad reinstalls that
overwrite `.claude/skills/`. The step files carry short pointers; **this file wins** if they ever
disagree.

---

## 1. Two checks, not one, and they are not interchangeable

Story 1.5d is the reason this file exists. Its four tasks ran 28 mutations and 27 were detected, which
looked like thorough verification. A local review afterwards found **four more defects**, one of
which was user-visible and serious: a document that had been read successfully reported "Reading" to
the treasurer on every later poll, forever.

**And then the fixes turned out to be the dangerous part.** Across three CodeRabbit rounds on that
story's merge request:

| Round | Findings | Where they were |
| --- | --- | --- |
| 1 | 20 | the original code |
| 2 | 2 | **both in round 1's fixes** |
| 3 | 6 | **including a constraint violation in a fix from round 1** |

Eight consecutive defects, every one of them introduced while repairing something else — a swallowed
404, a stale read reintroducing the bug it was fixing, a `NULL` token written alongside a non-`NULL`
expiry against a check constraint. None was caught by the person writing them, because nothing
checked a fix.

That is not an accident of that story. A fix is written under time pressure, against a narrower
mental model than the original code, touching machinery that already has subtle invariants. It is a
*higher*-risk context than first-draft code, and treating it as exempt has it exactly backwards.

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

The same seven steps at each of the three moments. "Task" below means whichever diff is in scope.

1. The diff reaches green and the full suite passes.
2. **Sensitivity check** — break the task's load-bearing assertion, confirm the test fails, restore,
   re-run. Existing `bmad-dev-tdd` Step 9 behaviour.
3. **Test-value pass** — §2a below. The tests in the diff are reviewed as work product, not as
   evidence.
4. **Adversarial review** — one `argus_review` call scoped to *this task's* diff.
5. Verify every finding against the real files (`argus-review-routing.md` §5 — mandatory).
6. Fix confirmed findings **test-first**: a regression test that fails against the pre-fix code.
7. Only then tick the checkbox.

A diff is not finished because its tests pass. It is finished when all three checks have run and what
they found has been fixed or recorded.

**A fix push is a diff.** It gets the same seven steps, scoped to the fix. If fixing a finding
introduces another, that is exactly the case this gate exists to catch, and it is the case that
actually happened eight times in a row.

## 2a. The test-value pass

**The tests in a fix diff are the half nobody re-reads.** Every other step here treats the suite as
the instrument and the production code as the subject. This step turns the instrument around.

Run `python3 _bmad/scripts/tests_touched.py <range>` to get the list — over a checklist, not over
memory. Then answer both questions for each case. They catch different things and **only one is
mechanical**:

| Defect | Symptom | Mutation finds it? |
| --- | --- | --- |
| **Vacuous** | Passes whether or not the code is right | **Yes** — break the code, the test stays green |
| **Expired premise** | Asserts what a *later* decision made wrong | **No** |

**A mutation cannot see an expired premise, and this is the whole reason the step exists.** Such a
test is *strongly* sensitive: break the code and it fails loudly. It looks like the best test in the
suite. Story 1.5d shipped two of them in a row — both asserting "releases the claim so a retry need
not wait", true when written and wrong the moment a retry cooldown existed — and each one **blocked
the fix it should have driven**. One was caught by an adversarial review reading the pair together,
the other by CodeRabbit. Neither by the suite, which stayed green throughout.

So for each touched case, in writing:

1. **Vacuous?** Break the code it covers. If the test still passes, it proves nothing.
2. **Expired?** Name the requirement it encodes, then check that requirement against every decision
   made *after* the test was written — especially decisions made later in the same story, which is
   where the premise silently rots.

**Then check the other direction: what lost its cover?** Re-specifying a test can strip the only
coverage from a behaviour that is still correct, and the suite gets *greener*, so nothing complains.
The same story, one round later: after two tests were correctly re-specified from "asserts a release"
to "asserts no release", the one remaining legitimate release had no test at all — deleting the call
left **all 1020 tests green**. A cheap sweep for this: grep the diff's test files for the concept
that changed, and confirm each surviving assertion is one you still mean.

## 3. Scoping the per-task call

`argus_review` costs ~10–18k input tokens of scaffolding per call before it reads anything, so the
scope must be the change in hand — the task's own diff, or the fix's — never the story's accumulated
diff:

```shell
# per task, or per fix push
diff = git diff <commit-at-start>..HEAD -- <paths this change touched>
```

Capture the SHA before starting a task, and before starting a round of review fixes. If the change is
not yet committed, `git diff HEAD` over its paths is the same scope.

Everything else follows `argus-review-routing.md` unchanged: `repo_root` is mandatory and absolute,
pass `diff`/`diff_file` rather than `git_range`, one call per scope, never one per file.

**Exclude story and planning documents.** They are the review's *spec*, loaded separately; reviewing
them as a diff is reviewing the prose against itself.

## 4. When a task's diff is exempt

The review may be skipped **only** when the task's diff is entirely one of:

1. documentation, comments, or story and planning files (including sprint status)
2. test fixtures or test-only changes with **no** production change

Nothing else. In particular there is **no size exemption**. An earlier version of this file allowed
skipping "fewer than ~20 lines with no new branch, no new state and no new external call", and that
was wrong in the way this project keeps finding things wrong: a rule whose own conditions are the
judgement it is meant to remove. Deciding a diff has "no new state" is exactly the reasoning the
review exists to check, and the smallest diffs in this story were among the most dangerous — the
change that made `provider_unavailable` terminal was two lines, and it could have lost a document
permanently.

**State which of the two categories applied, in the completion notes, every time.** A skipped check
nobody mentions reads exactly like a check that passed — which is the failure this whole file exists
to prevent.

## 5. The whole-story pass still happens

`bmad-ship-story` Step 6 keeps its review of `baseline_commit..HEAD`. Per-task reviews cannot see
across tasks — an interaction between task 2's schema and task 3's write path is invisible to both
individually. The final pass is the integration pass, and its scope should be stated as such.

## 6. Cost, stated plainly

Roughly one `argus_review` call per task, one per story, and one per round of review fixes. On story
1.5d that is four tasks, one integration pass and three fix rounds — eight calls. The single
whole-story call it did run cost ~392k tokens, so budget accordingly, and prefer
`provider: "offline"` when the point is to test wiring rather than to get findings.

If cost ever forces a choice, drop the **integration pass** before the other two. The per-task and
per-fix reviews catch defects while the change is still in mind and before anything is built on top
of them; the integration pass mostly re-reads code that has already been through one. That ordering
is the opposite of what it was in the first version of this file, and the fix data above is why.
