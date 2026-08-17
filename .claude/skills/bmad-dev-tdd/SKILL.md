---
name: bmad-dev-tdd
description: 'Execute story implementation under strict test-driven development. Every behavior gets a failure-mode analysis and test lists before any production code, then runs red-green-refactor, then hardens the code defensively against the failures the tests proved. Use when the user says "TDD this story", "implement this story test-first", or wants implementation that is defensive by construction rather than tests written after the fact.'
---

# Dev TDD Workflow

**Goal:** Execute story implementation test-first, so that every behavior is specified by a failing test, every plausible failure mode is either proven handled or explicitly out of scope, and the resulting code is defensive by construction.

**Your Role:** Developer practicing disciplined TDD.

- Communicate all responses in {communication_language} and language MUST be tailored to {user_skill_level}
- Generate all documents in {document_output_language}
- Only modify the story file in these areas: YAML frontmatter `baseline_commit`, Tasks/Subtasks checkboxes, Dev Agent Record (Debug Log, Test Design, Completion Notes), File List, Change Log, and Status
- Execute ALL steps in exact order; do NOT skip steps
- Absolutely DO NOT stop because of "milestones", "significant progress", or "session boundaries". Continue in a single execution until the story is COMPLETE (all ACs satisfied and all tasks/subtasks checked) UNLESS a HALT condition is triggered or the USER gives other instruction.
- Do NOT schedule a "next session" or request review pauses unless a HALT condition applies. Only Step 10 decides completion.
- User skill level ({user_skill_level}) affects conversation style ONLY, not code or test rigor.

## The Prime Directive

**New code is guilty until proven innocent.** Production code is written only to make a failing test pass. If you find yourself writing an `if`, a `throw`, a null check, or a boundary clamp that no test demanded, stop — go write the test that demands it, watch it fail, then write the guard.

## Porting this skill

Nothing here is repo-specific — no forge, no build commands, no paths. It does depend on three things that must travel with it:

1. **`_bmad/custom/review-gate.md`** and **`_bmad/custom/argus-review-routing.md`** — Step 9's adversarial review is defined by them.
2. **`_bmad/custom/bmad-dev-tdd.toml`** — loads those two as persistent facts, and re-establishes the after-every-task review if a BMad reinstall overwrites this file.
3. **An `argus_review` MCP tool.** Without one, Step 9 keeps the sensitivity check and the test-value pass and loses the third check; say so rather than reporting a satisfied gate.

Story numbers cited below are evidence from the repository this was written in. The rules stand without them.

## Conventions

- Bare paths (e.g. `test-design-reference.md`) resolve from the skill root.
- `{skill-root}` resolves to this skill's installed directory (where `customize.toml` lives).
- `{project-root}`-prefixed paths resolve from the project working directory.
- `{skill-name}` resolves to the skill directory's basename.

## On Activation

### Step 1: Resolve the Workflow Block

Run: `python3 {project-root}/_bmad/scripts/resolve_customization.py --skill {skill-root} --key workflow`

**If the script fails**, resolve the `workflow` block yourself by reading these three files in base → team → user order and applying the same structural merge rules as the resolver:

1. `{skill-root}/customize.toml` — defaults
2. `{project-root}/_bmad/custom/{skill-name}.toml` — team overrides
3. `{project-root}/_bmad/custom/{skill-name}.user.toml` — personal overrides

Any missing file is skipped. Scalars override, tables deep-merge, arrays of tables keyed by `code` or `id` replace matching entries and append new entries, and all other arrays append.

The resolved `{workflow.tdd}` table controls test rigor for this run. Carry its values for the whole workflow.

### Step 2: Execute Prepend Steps

Execute each entry in `{workflow.activation_steps_prepend}` in order before proceeding.

### Step 3: Load Persistent Facts

Treat every entry in `{workflow.persistent_facts}` as foundational context you carry for the rest of the workflow run. Entries prefixed `file:` are paths or globs under `{project-root}` — load the referenced contents as facts. All other entries are facts verbatim.

### Step 4: Load Test Design Reference

Read `test-design-reference.md` fully. It is the authority on what tests to write for each behavior — the four Questions to Ask, the six test-list dimensions under "What to Test", the boundary-condition checklist, and the test-quality gate under "Good Tests Are reliable". You will apply it in Step 6 for every behavior you implement. Do not proceed from memory — load it.

### Step 5: Load Config

**Precondition — this workflow extends bmm.** If `{project-root}/_bmad/bmm/config.yaml` does not exist, HALT immediately with:

> `bmad-dev-tdd` requires the BMad Method (`bmm`) module, which is not installed. Add it with `npx bmad-method install --modules bmm`, then run this workflow again.

Do NOT substitute this module's own `{project-root}/_bmad/bmad-tdd/config.yaml` — the installer generates it, but it carries only the shared core values and has neither `user_skill_level` nor `implementation_artifacts`. Do NOT proceed with those values unresolved: `implementation_artifacts` is what `sprint_status` and story discovery are built on, and continuing without it produces a misleading "no ready-for-dev stories found" instead of naming the real problem. Fail loudly here rather than degrade quietly — the same standard this workflow holds the code it writes to.

Load config from `{project-root}/_bmad/bmm/config.yaml` and resolve:

- `project_name`, `user_name`
- `communication_language`, `document_output_language`
- `user_skill_level`
- `implementation_artifacts`
- `date` as system-generated current datetime
- `project_context` = `**/project-context.md` (load if exists)

If any of `user_skill_level` or `implementation_artifacts` is missing from an otherwise-present config, HALT and name the missing key rather than guessing a default.

### Step 6: Greet the User

Greet `{user_name}`, speaking in `{communication_language}`.

### Step 7: Execute Append Steps

Execute each entry in `{workflow.activation_steps_append}` in order.

Activation is complete. If `activation_steps_prepend` or `activation_steps_append` were non-empty, confirm every entry was executed in order before proceeding. Do not begin the main workflow until all activation steps have been completed.

## Paths

- `story_file` = `` (explicit story path; auto-discovered if empty)
- `sprint_status` = `{implementation_artifacts}/sprint-status.yaml`
- `test_design_reference` = `test-design-reference.md`
- `dod_checklist` = `checklist.md`

## Execution

<workflow>
  <critical>Communicate all responses in {communication_language} and language MUST be tailored to {user_skill_level}</critical>
  <critical>Generate all documents in {document_output_language}</critical>
  <critical>Only modify the story file in these areas: YAML frontmatter `baseline_commit`, Tasks/Subtasks checkboxes, Dev Agent Record
    (Debug Log, Test Design, Completion Notes), File List, Change Log, and Status</critical>
  <critical>Execute ALL steps in exact order; do NOT skip steps</critical>
  <critical>NEVER write production code before a test that fails for the right reason exists and has been observed failing</critical>
  <critical>NEVER weaken, delete, or skip a test to make a suite go green. Fix the code, or HALT with the conflict stated</critical>
  <critical>Absolutely DO NOT stop because of "milestones", "significant progress", or "session boundaries". Continue in a single
    execution until the story is COMPLETE (all ACs satisfied and all tasks/subtasks checked) UNLESS a HALT condition is triggered or
    the USER gives other instruction.</critical>
  <critical>User skill level ({user_skill_level}) affects conversation style ONLY, not code or test rigor.</critical>

  <step n="1" goal="Find next ready story and load it" tag="sprint-status">
    <check if="{{story_path}} is provided">
      <action>Use {{story_path}} directly</action>
      <action>Read COMPLETE story file</action>
      <action>Extract story_key from filename or metadata</action>
      <goto anchor="task_check" />
    </check>

    <!-- Sprint-based story discovery -->
    <check if="{{sprint_status}} file exists">
      <critical>MUST read COMPLETE sprint-status.yaml file from start to end to preserve order</critical>
      <action>Load the FULL file: {{sprint_status}}</action>
      <action>Parse the development_status section completely to understand story order</action>
      <action>Find the FIRST story (reading top to bottom) where:
        - Key matches pattern: number-number-name (e.g., "1-2-user-auth")
        - NOT an epic key (epic-X) or retrospective (epic-X-retrospective)
        - Status value equals "ready-for-dev"
      </action>

      <check if="no ready-for-dev or in-progress story found">
        <output>📋 No ready-for-dev stories found in sprint-status.yaml

          **What would you like to do?**
          1. Run `create-story` to create the next story from epics with comprehensive context
          2. Run `create-story:validate` to improve existing stories before development
          3. Specify a particular story file to develop (provide full path)
          4. Review {{sprint_status}} to see current sprint status
        </output>
        <ask>Choose option [1], [2], [3], or [4], or specify story file path:</ask>

        <check if="user chooses '1'">
          <action>HALT - Run create-story to create next story</action>
        </check>
        <check if="user chooses '2'">
          <action>HALT - Run create-story:validate to improve existing stories</action>
        </check>
        <check if="user chooses '3' or provides a story file path">
          <ask>Provide the story file path to develop:</ask>
          <action>Store user-provided story path as {{story_path}}</action>
          <goto anchor="task_check" />
        </check>
        <check if="user chooses '4'">
          <action>Display detailed sprint status analysis</action>
          <action>HALT - User can review sprint status and provide story path</action>
        </check>
      </check>
    </check>

    <!-- Non-sprint story discovery -->
    <check if="{{sprint_status}} file does NOT exist">
      <action>Search {implementation_artifacts} for story files matching pattern: *-*-*.md</action>
      <action>Read each candidate story file to check its Status section for "ready-for-dev"</action>

      <check if="no ready-for-dev stories found in story files">
        <ask>No ready-for-dev stories found. Provide the full path to the story file you want developed:</ask>
        <action>Store user-provided story path as {{story_path}}</action>
      </check>
    </check>

    <action>Store the found story_key (e.g., "1-2-user-authentication") for later status updates</action>
    <action>Read COMPLETE story file from the discovered path</action>

    <anchor id="task_check" />

    <action>Parse sections: Story, Acceptance Criteria, Tasks/Subtasks, Dev Notes, Dev Agent Record, File List, Change Log, Status</action>
    <action>Extract developer guidance from Dev Notes: architecture requirements, previous learnings, technical specifications</action>
    <action>Identify first incomplete task (unchecked [ ]) in Tasks/Subtasks</action>

    <action if="no incomplete tasks">
      <goto step="10">Completion sequence</goto>
    </action>
    <action if="story file inaccessible">HALT: "Cannot develop story without access to story file"</action>
    <action if="incomplete task or subtask requirements ambiguous">ASK user to clarify or HALT</action>
  </step>

  <step n="2" goal="Establish the test baseline">
    <critical>You cannot practice TDD in a suite you cannot run. Establish the baseline BEFORE writing anything</critical>

    <action>Load {project_context} for coding standards and project-wide patterns (if exists)</action>
    <action>Infer the test framework, test file naming convention, assertion style, and test command from the existing project
      (test config files, existing test directories, package manifests, CI config)</action>
    <action>Record the exact command used to run the full suite and the command used to run a single test file</action>
    <action>Run the FULL existing suite now and record the result as the baseline</action>

    <check if="no test framework exists in the project">
      <action>Identify the conventional framework for this stack and the minimal setup required</action>
      <ask>This project has no test harness. TDD requires one. Proposed setup: {{proposed_harness}}. Approve, or specify an
        alternative?</ask>
      <action if="user declines">HALT: "TDD workflow requires a runnable test harness"</action>
      <action>Set up the harness and verify a trivial test can run and fail</action>
    </check>

    <check if="baseline suite has pre-existing failures">
      <action>Record every pre-existing failure explicitly as {{baseline_failures}}</action>
      <output>⚠️ **Baseline is not green** — {{baseline_failure_count}} pre-existing failures recorded.

        These are excluded from this story's regression gate but will be reported at completion. Any NEW failure is yours.
      </output>
    </check>

    <check if="baseline suite is green">
      <action>Set {{baseline_failures}} = empty</action>
      <output>✅ **Baseline green** — {{baseline_test_count}} tests passing. Regression gate is active.</output>
    </check>
  </step>

  <step n="3" goal="Detect review continuation and extract review context">
    <action>Check if a "Senior Developer Review (AI)" section exists in the story file</action>

    <check if="Senior Developer Review section exists">
      <action>Set review_continuation = true</action>
      <action>Extract review outcome, review date, action items with checkboxes, and severity breakdown</action>
      <action>Store list of unchecked review items as {{pending_review_items}}</action>
      <critical>Every review follow-up is itself a TDD cycle: reproduce the finding with a failing test FIRST, then fix. A review
        finding without a regression test is not resolved</critical>
      <output>⏯️ **Resuming After Code Review** ({{review_date}}) — {{unchecked_review_count}} items remaining.

        Each will be driven by a failing regression test before any fix is applied.
      </output>
    </check>

    <check if="Senior Developer Review section does NOT exist">
      <action>Set review_continuation = false and {{pending_review_items}} = empty</action>
      <output>🚀 **Starting Fresh TDD Implementation** — Story: {{story_key}}, first task: {{first_task_description}}</output>
    </check>
  </step>

  <step n="4" goal="Mark story in-progress" tag="sprint-status">
    <action>If story file YAML frontmatter already contains `baseline_commit`, preserve the existing value and do not overwrite it</action>

    <check if="{{sprint_status}} file exists">
      <action>Load the FULL file: {{sprint_status}}</action>
      <action>Set {{current_status}} to development_status[{{story_key}}]</action>
    </check>
    <check if="{{sprint_status}} file does NOT exist">
      <action>Set {{current_status}} to the story file Status section value</action>
      <action>Set {{current_sprint_status}} = "no-sprint-tracking"</action>
    </check>

    <check if="{{current_status}} == 'ready-for-dev' AND story file YAML frontmatter does NOT contain baseline_commit">
      <action>Run `git rev-parse HEAD` to capture current commit into {{baseline_commit}}; if version control is unavailable, set
        {{baseline_commit}} = `NO_VCS`</action>
      <action>Add `baseline_commit: {{baseline_commit}}` to the story file YAML frontmatter, creating the frontmatter if absent</action>
    </check>

    <check if="{{sprint_status}} file exists AND ({{current_status}} == 'ready-for-dev' OR (review_continuation == true AND {{current_status}} != 'in-progress'))">
      <action>Update the story in the sprint status report to "in-progress" and update last_updated to current date</action>
      <output>🚀 Starting work on story {{story_key}} — status: {{current_status}} → in-progress</output>
    </check>
  </step>

  <step n="5" goal="Failure-mode analysis for the current task — BEFORE any test or code">
    <critical>FOLLOW THE STORY FILE TASKS/SUBTASKS SEQUENCE EXACTLY AS WRITTEN - NO DEVIATION</critical>
    <critical>This step produces no code and no tests. Its only output is a written list of ways this behavior can break</critical>

    <action>Review the current task/subtask from the story file - this is your authoritative implementation guide</action>
    <action>Decompose the task into the discrete behaviors (methods, functions, handlers, or units) it requires</action>

    <action>For EACH behavior, answer the four questions from {test_design_reference} in writing:
      1. If this code ran correctly, how would I know? (the observable success signal)
      2. How am I going to test this? (seams, injection points, fakes needed — if the answer is "I can't", the design is wrong,
         change the design now, not later)
      3. What else can go wrong? (the failure modes)
      4. Could this same kind of problem happen anywhere else? (sibling code with the same defect shape)
    </action>

    <action>Enumerate the PRIMARY failure modes for each behavior — the ways it most plausibly breaks in production, not exotic ones.
      Draw candidates from at minimum:
      - Invalid, absent, empty, or malformed input reaching the behavior
      - The unhappy path of every external call (I/O, network, database, filesystem, clock, another module)
      - Boundaries: every applicable dimension from the boundary-condition checklist in {test_design_reference}
      - State the behavior assumes but does not verify (initialization order, prior calls, non-null collaborators)
      - Concurrency, re-entrancy, or ordering assumptions when the behavior is reachable from more than one caller
      - Partial failure: what is left half-written when the behavior throws midway
    </action>

    <action>Produce at least {workflow.tdd.min_failure_modes_per_behavior} failure modes per behavior. If you genuinely cannot,
      state in writing why the behavior is trivial enough to warrant fewer</action>

    <action>Classify each failure mode as one of:
      - GUARD — the code must detect and handle it (needs a test that forces it)
      - PROPAGATE — the code must let it escape, but with a defined, tested type/message
      - OUT-OF-SCOPE — deliberately not handled here; record WHY and where it IS handled
    </action>

    <action>Write the classified list into the story file's Dev Agent Record under a "Test Design" subsection, keyed by behavior</action>

    <action if="a failure mode contradicts an acceptance criterion or the story is silent on required behavior">
      ASK the user for the intended behavior — do not invent an error contract
    </action>
    <action if="the behavior cannot be tested without changing its design">
      <action>Change the design now: introduce the seam (inject the dependency, extract the pure core, pass the clock in)</action>
      <action if="the required design change exceeds the story's scope">HALT and request guidance</action>
    </action>
  </step>

  <step n="6" goal="RED — derive the test list and write failing tests">
    <critical>No production code in this step. None</critical>

    <action>For each behavior, derive its test list by walking all six dimensions under "What to Test" in {test_design_reference},
      in the order they appear there:
      1. **Right** — the ordinary, expected case, with realistic inputs (write this one first)
      2. **Boundary conditions** — apply every dimension in that section's checklist that applies to this behavior: format,
         parameter ordering, value limits, external references, null/absent values, zero-one-many counts, and time ordering
      3. **Reverse it** — can the result be checked by inverting the operation (parse then serialize, insert then read,
         encrypt then decrypt)?
      4. **Cross check** — can the result be verified a second, independent way (a known-good oracle, a slower obvious algorithm,
         a second data source, a conservation property)?
      5. **Force the error states** — make each GUARD and PROPAGATE failure mode from Step 5 actually happen
      6. **Performance** — assert bounds only when the story or Dev Notes states one
    </action>

    <check if="{workflow.tdd.require_inverse_or_crosscheck} == true">
      <action>Every behavior that transforms or persists data must have at least one reverse-it OR cross-check test, or a written
        justification for why neither applies</action>
    </check>

    <action>Write the tests. Each test must pass the quality gate in {test_design_reference} ("Good Tests Are reliable"):
      - Automatic: no manual setup, no prompts, no human inspection of output
      - Thorough: covers the derived list, not just the happy path
      - Repeatable: no dependence on wall-clock time, random seeds, network, ordering, or leftover state — inject those
      - Independent: passes alone and in any order; one test verifies one thing
      - Professional: named for the behavior and condition it asserts; no copy-paste drift; refactored like production code
      - **Not satisfied by its own fixture:** pick inputs where a wrong implementation must give a
        different answer. `toContain('12')` against an amount of `1240.00` passes with the feature
        deleted; two reads of an unchanged table agree whatever the query does; a cap asserted on an
        input that never reaches it proves nothing. Breaking the *code* cannot find these, so the
        fixture is where the care goes
    </action>

    <action>Name each test so a failure message alone identifies the behavior AND the condition (e.g.
      `rejects_withdrawal_when_balance_below_amount`, not `test_withdraw_2`)</action>

    <action>RUN THE TESTS NOW. Observe them fail</action>

    <critical>Verify each test fails FOR THE RIGHT REASON — a missing-symbol or import error is not a valid red. It must fail on the
      assertion, or on the specific error the behavior is supposed to raise. A test that passes before implementation is a broken
      test: fix it before continuing</critical>

    <action>Record the red result (test names and failure reasons) in Dev Agent Record → Debug Log</action>
  </step>

  <step n="7" goal="GREEN — minimal implementation that makes the tests pass">
    <action>Implement the SIMPLEST code that makes the failing tests pass. No speculative generality, no unrequested features,
      no configuration knobs nobody asked for</action>
    <action>Implement guards ONLY for failure modes classified GUARD in Step 5 and now proven by a red test</action>
    <action>Follow architecture patterns and coding standards from Dev Notes and {project_context}</action>
    <action>Run the tests. Confirm they now pass</action>

    <check if="a test still fails after implementation">
      <action>Fix the code, not the test</action>
      <action if="the test itself is proven wrong">Correct the test, re-observe it failing against the old code path, then continue</action>
    </check>

    <action if="new dependencies required beyond story specifications">HALT: "Additional dependencies need user approval"</action>
    <action if="3 consecutive implementation failures occur on the same behavior">HALT and request guidance</action>
    <action if="required configuration is missing">HALT: "Cannot proceed without necessary configuration files"</action>
  </step>

  <step n="8" goal="REFACTOR and harden — defensive posture with tests still green">
    <critical>The suite stays green through every edit in this step. Run it after each meaningful change</critical>

    <action>Improve structure: remove duplication, clarify names, extract intent-revealing helpers, collapse accidental complexity</action>
    <action>Refactor the TESTS too — duplication and unclear naming in tests is technical debt with interest</action>

    <action>Apply defensive hardening in the {workflow.tdd.defensive_style} style, in this order of preference:
      1. **Make the failure unrepresentable** — narrow the type, make the field non-nullable, make the invalid state unconstructable.
         Preferred over any runtime check
      2. **Guard at the boundary** — validate untrusted input once, at the edge (public API, deserialization, request handler), so the
         interior can trust its inputs. Do not scatter redundant checks through interior code
      3. **Fail fast and loudly** — on a violated precondition, raise a specific, named, documented error immediately. Never continue
         with a degraded value, never silently coerce, never swallow an exception into a default
      4. **Leave no partial state** — a behavior that throws midway must not leave the system half-updated: order the work so the
         fallible part happens before the mutation, or make the mutation reversible
    </action>

    <critical>Every guard added here must be justified by a test written in Step 6. If you are adding a guard with no test behind it,
      you skipped a failure mode — go back to Step 5 for that behavior, add it, watch it fail, then come back</critical>

    <action>Re-read the Step 5 list. For each GUARD failure mode, confirm a passing test forces exactly that path</action>
    <action>For each PROPAGATE failure mode, confirm a test asserts the specific error type and that it escapes uncaught</action>
    <action>Apply question 4 from Step 5: search the codebase for sibling code with the same defect shape. Report what you find —
      fix it only if the story covers it, otherwise record it in Completion Notes as a follow-up</action>

    <action>Run the full suite. Confirm green (excluding {{baseline_failures}})</action>
    <action>Document the approach and decisions in Dev Agent Record → Test Design</action>
  </step>

  <step n="9" goal="Validate and mark task complete ONLY when fully done">
    <critical>NEVER mark a task complete unless ALL gates below pass - NO LYING OR CHEATING</critical>

    <!-- VALIDATION GATES -->
    <action>Verify every test for this task ACTUALLY EXISTS and PASSES</action>
    <action>Verify every behavior from Step 5 has a "Right" test, its applicable boundary-condition tests, and an error-condition
      test per GUARD/PROPAGATE failure mode</action>
    <action>Verify no test was weakened, skipped, marked pending, or deleted during this task</action>
    <action>Confirm implementation matches EXACTLY what the task/subtask specifies - no extra features</action>
    <action>Validate that ALL acceptance criteria related to this task are satisfied</action>
    <action>Run the FULL suite. Confirm no new failures relative to {{baseline_failures}}</action>
    <action>Run linting and static analysis if configured in the project</action>

    <check if="{workflow.tdd.verify_test_sensitivity} == true">
      <action>Sensitivity check on the task's most important assertion: temporarily break the production code path it covers,
        confirm the test fails, then restore the code exactly. A test that passes against broken code is worthless</action>
      <action>Then break the **fixture** on any assertion whose input could satisfy it independently of the
        code: change the input so the expected outcome must change, leaving the code and the expected value
        alone. Still green means the fixture was doing the work, not the code. Mutation cannot reach this
        class — Epic 4 shipped four of them in one story and the code-mutation pass caught none</action>
      <critical>Restore the fixture and re-run before proceeding. A mutated input left behind reads as a
        legitimate test case, which a mutated production line never does</critical>
      <critical>Restore the code immediately and re-run the suite to confirm green before proceeding</critical>
    </check>

    <check if="{workflow.tdd.review_each_task} == true">
      <critical>`_bmad/custom/review-gate.md` is the authoritative contract for this block and is loaded as a persistent
        fact on activation. If this step file and that one ever disagree, that one wins — this one is overwritten by a BMad
        reinstall and that one is not</critical>
      <action>Run the adversarial review on THIS TASK'S diff — one `argus_review` call, scoped to the paths this task touched
        since the SHA captured when it started. Follow `_bmad/custom/argus-review-routing.md` for the call shape: `repo_root`
        mandatory and absolute, pass the diff rather than a `git_range`, one call per scope</action>
      <action>Verify EVERY finding against the real file before assigning severity — the engine reasons from a token-budgeted
        slice and can cite code it only partly saw. Label each confirmed, not-reproduced, or disagree</action>
      <action>Fix confirmed findings test-first: a regression test that fails against the pre-fix code and passes after</action>
      <action if="the task's diff is ENTIRELY documentation/comments/story/planning files, OR entirely test-only changes with
        no production change">Skip the call and SAY WHICH of those two applied, in the completion notes. There is no size
        exemption: judging a small diff to be harmless is the reasoning the review exists to check, and the two-line change
        that made `provider_unavailable` terminal could have lost a document permanently. A skipped check nobody mentions
        reads exactly like a check that passed</action>
      <critical>This is NOT the same check as the sensitivity pass above and does not replace it. Mutation testing asks whether
        the tests notice a line changing, so it only probes where a test already exists; the review asks what was never
        considered. Story 1.5d ran 29 mutations, detected 28, and still carried four defects into review — including one that
        showed "Reading" to the treasurer forever for a document that had been read successfully, because two different
        situations returned the same value and no assertion existed to mutate</critical>
    </check>

    <!-- REVIEW FOLLOW-UP HANDLING -->
    <check if="task is a review follow-up (has [AI-Review] prefix)">
      <action>Confirm a regression test exists that fails against the pre-fix code and passes now</action>
      <action>Mark task checkbox [x] in "Tasks/Subtasks → Review Follow-ups (AI)"</action>
      <action>Find the matching action item in "Senior Developer Review (AI) → Action Items" and mark it [x] resolved</action>
      <action>Add to Completion Notes: "✅ Resolved review finding [{{severity}}]: {{description}} — regression test:
        {{test_name}}"</action>
    </check>

    <check if="ALL validation gates pass">
      <action>ONLY THEN mark the task (and its subtasks) checkbox with [x]</action>
      <action>Update File List with ALL new, modified, or deleted files (paths relative to repo root), tests included</action>
      <action>Add completion notes summarizing what was implemented, which failure modes are now guarded, and which were
        deliberately left out of scope</action>
    </check>

    <check if="ANY validation fails">
      <action>DO NOT mark task complete - fix the issues first</action>
      <action>HALT if unable to fix validation failures</action>
    </check>

    <action>Save the story file</action>
    <action>**Any scripted edit is read back afterwards.** An anchored replacement whose assertion fails is a
      change that did not happen. Verify the replacement — the old text gone, the match count as expected —
      not merely that the new text appears somewhere; grep passes when the string already existed elsewhere.
      A story
      has been closed out claiming an edit that never applied</action>
    <action if="more incomplete tasks remain">
      <goto step="5">Next task — new failure-mode analysis</goto>
    </action>
    <action if="no tasks remain">
      <goto step="10">Completion</goto>
    </action>
  </step>

  <step n="10" goal="Story completion and mark for review" tag="sprint-status">
    <action>Verify ALL tasks and subtasks are marked [x] (re-scan the story document now)</action>
    <action>Run the full regression suite (do not skip)</action>
    <action>Confirm File List includes every changed file</action>
    <action>Execute the definition-of-done validation in {dod_checklist}</action>
    <action>Update the story Status to: "review"</action>

    <check if="{{sprint_status}} file exists AND {{current_sprint_status}} != 'no-sprint-tracking'">
      <action>Load the FULL file, find development_status key matching {{story_key}}, set it to "review", update last_updated</action>
      <action>Save file, preserving ALL comments and structure including STATUS DEFINITIONS</action>
      <output>✅ Story status updated to "review" in sprint-status.yaml</output>
    </check>

    <check if="story key not found in sprint status">
      <output>⚠️ Story file updated, but sprint-status update failed: {{story_key}} not found — sprint-status.yaml may be out of sync.</output>
    </check>

    <action if="any task is incomplete">HALT - Complete remaining tasks before marking ready for review</action>
    <action if="new regression failures exist">HALT - Fix regressions before completing</action>
    <action if="File List is incomplete">HALT - Update File List with all changed files</action>
    <action if="definition-of-done validation fails">HALT - Address DoD failures before completing</action>
  </step>

  <step n="11" goal="Completion communication and user support">
    <action>Communicate to {user_name} that the story is complete and ready for review</action>
    <action>Summarize: story key and title, behaviors implemented, tests added (count and what they pin down), failure modes now
      guarded, failure modes deliberately out of scope and why, files modified, and final suite result</action>
    <action>Report any sibling defects found in Step 8 that were left as follow-ups</action>
    <action if="{{baseline_failures}} is non-empty">Restate the pre-existing failures that were present before this story and remain</action>

    <action>Based on {user_skill_level}, ask if the user wants explanations of:
      - What was implemented and how it works
      - Why particular failure modes were guarded versus propagated
      - How to run the tests and read their output
      - Any patterns, libraries, or approaches used
    </action>

    <action>Suggest logical next steps:
      - Review the implementation and run the tests
      - Run `code-review` for peer review
      - Optional: if the Test Architect module is installed, run `/bmad:tea:automate` to expand guardrail tests
    </action>

    <output>💡 **Tip:** For best results, run `code-review` using a **different** LLM than the one that implemented this story.</output>

    <action>Run: `python3 {project-root}/_bmad/scripts/resolve_customization.py --skill {skill-root} --key workflow.on_complete` — if
      the resolved value is non-empty, follow it as the final terminal instruction before exiting.</action>
  </step>

</workflow>
