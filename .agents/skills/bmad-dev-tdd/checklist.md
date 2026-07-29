---
title: 'TDD Definition of Done Checklist'
validation-target: 'Story markdown ({{story_path}}) and its test suite'
validation-criticality: 'HIGHEST'
required-inputs:
  - 'Story markdown file with Dev Notes containing implementation context'
  - 'Completed Tasks/Subtasks section with all items marked [x]'
  - 'Dev Agent Record → Test Design section with per-behavior failure-mode analysis'
  - 'Updated File List section with all changed files, tests included'
optional-inputs:
  - 'Test results output'
  - 'Coverage report'
  - 'Linting and static analysis reports'
validation-rules:
  - 'Only permitted story sections modified: Tasks/Subtasks checkboxes, Dev Agent Record, File List, Change Log, Status'
  - 'Every production behavior traces back to a test that was observed failing first'
  - 'Every guard in production code traces back to a test that forces it'
  - 'No test was weakened, skipped, or deleted to reach green'
---

# 🎯 TDD Definition of Done

**Critical validation:** the story is ready for review only when ALL items below are satisfied.

## 🔴 Test-First Discipline

- [ ] **Red Observed:** Every behavior had a failing test before its production code existed
- [ ] **Failed For The Right Reason:** No red was a missing-import or missing-symbol error — each failed on its assertion or on the specific expected error
- [ ] **No Retrofitted Tests:** No test in this story was written after the code it covers
- [ ] **No Suite Gaming:** No test was weakened, marked skip/pending, or deleted to reach green
- [ ] **Minimal Green:** Production code contains nothing beyond what a test demanded — no speculative features or unused knobs

## 🔍 Failure-Mode Analysis (Step 5)

- [ ] **Analysis Recorded:** Dev Agent Record → Test Design contains a per-behavior failure-mode list
- [ ] **Four Questions Answered:** Observable success signal, testability seams, what else can go wrong, and where else this defect shape occurs
- [ ] **Threshold Met:** At least the configured minimum failure modes per behavior, or a written justification for fewer
- [ ] **Fully Classified:** Every failure mode is marked GUARD, PROPAGATE, or OUT-OF-SCOPE — none unclassified
- [ ] **Out-Of-Scope Justified:** Each OUT-OF-SCOPE item records why, and where it is handled instead

## 🧪 Test Coverage: the six dimensions

- [ ] **Right:** Each behavior has a test for the ordinary expected case
- [ ] **Boundary Conditions:** Every applicable dimension covered — format, parameter ordering, value limits, external references, null/absent values, zero-one-many counts, time ordering
- [ ] **Reverse It / Cross Check:** Data-transforming and persisting behaviors carry a reverse-it or cross-check test, or a justification
- [ ] **Error States Forced:** Every GUARD failure mode has a test that actually makes it happen; every PROPAGATE mode asserts the specific error escapes
- [ ] **Performance:** Bounds asserted where the story states one, expressed as a property (query count, complexity) not a wall-clock number

## ✅ Test Quality

- [ ] **Automatic:** No manual setup, prompts, or human inspection of output
- [ ] **Thorough:** The derived test list was implemented, not a happy-path subset
- [ ] **Repeatable:** No real clock, unseeded randomness, network, ordering dependence, or shared mutable state
- [ ] **Independent:** Each test passes alone and in any order; each verifies one thing
- [ ] **Professional:** Tests named for behavior and condition, refactored, free of copy-paste drift
- [ ] **Sensitivity Verified:** The task's key assertions were confirmed to fail against deliberately broken code, then the code restored

## 🛡️ Defensive Posture

- [ ] **Every Guard Justified:** No guard, null check, or clamp exists without a test that forces it
- [ ] **Boundary Validation:** Untrusted input validated once at the edge; interior code not littered with redundant checks
- [ ] **Fail Fast:** Violated preconditions raise specific named errors — nothing silently coerced, defaulted, or swallowed
- [ ] **No Partial State:** Behaviors that can throw midway leave no half-updated state, or the mutation is reversible
- [ ] **Sibling Defects Reported:** Codebase searched for the same defect shape elsewhere; findings fixed if in scope, reported if not

## 📋 Implementation Completion

- [ ] **All Tasks Complete:** Every task and subtask marked [x]
- [ ] **Acceptance Criteria Satisfied:** Implementation satisfies EVERY Acceptance Criterion in the story
- [ ] **Architecture Compliance:** Follows architectural requirements and technical specifications from Dev Notes
- [ ] **Dependencies Within Scope:** Only dependencies specified in the story or project-context.md
- [ ] **No New Regressions:** Full suite run; no failure that was not already in the recorded baseline
- [ ] **Code Quality:** Linting and static analysis pass where configured

## 📝 Documentation & Tracking

- [ ] **File List Complete:** Every new, modified, or deleted file listed, test files included (paths relative to repo root)
- [ ] **Test Design Recorded:** Dev Agent Record documents the analysis, the resulting test list, and the decisions behind it
- [ ] **Change Log Updated:** Clear summary of what changed and why
- [ ] **Review Follow-ups:** Each [AI-Review] item has a regression test and its review action item is marked resolved
- [ ] **Story Structure Compliance:** Only permitted sections of the story file were modified

## 🔚 Final Status Verification

- [ ] **Story Status Updated:** Story Status set to "review"
- [ ] **Sprint Status Updated:** Sprint status set to "review" (when sprint tracking is used)
- [ ] **Baseline Failures Reported:** Any pre-existing failures still present are restated to the user
- [ ] **No HALT Conditions:** No blocking issues or incomplete work remaining

## 🎯 Final Validation Output

```
Definition of Done: {{PASS/FAIL}}

✅ **Story Ready for Review:** {{story_key}}
📊 **Completion Score:** {{completed_items}}/{{total_items}} items passed
🔴 **Red-Green Cycles:** {{cycle_count}} behaviors driven test-first
🛡️ **Failure Modes:** {{guarded_count}} guarded, {{propagated_count}} propagated, {{out_of_scope_count}} out of scope
🧪 **Test Results:** {{test_results_summary}}
📝 **Documentation:** {{documentation_status}}
```

**If FAIL:** list the specific failures and the actions required before the story can be marked ready for review.

**If PASS:** the story is fully ready for code review and production consideration.
