---
name: bmad-ship-story
description: 'Run a single story end-to-end on its own branch: create it, implement it test-first, review it locally with Argus and `ocr`, open a merge request to main, and stop at ready-to-merge. Use when the user says "ship a story", "ship the next story", "run the story pipeline", or "ship story <id>". The MR review is asynchronous, so a run may end at a wait; called in a loop by bmad-implement-epic.'
---

# Ship Story Pipeline

Take one story to a green, reviewed, ready-to-merge MR. **One story = one branch = one MR = one review cycle** — story-sized diffs are the largest a reviewer can hold in their head.

Resumable: every run detects state from `sprint-status.yaml`, git and the MR, then advances. Safe to re-run.

## Conventions

- `implementation_artifacts` = `_bmad-output/implementation-artifacts`; `sprint_status` = that + `/sprint-status.yaml`; `story_file` = that + `/{story_key}.md`.
- **GitLab only.** `glab` for all remote ops; MRs not PRs.
- **CI:** `{ci}`. Where there is none, the local gate is the only evidence a head is green — say "gates green locally on `<sha>`", never "pipeline green".
- Project path `{project}`, encoded `{project_encoded}` for `glab api`.
- Never guess MR state — query it.

## Hard rules

- **Never merge, never push to `main`.** Terminal state is ready-to-merge.
- **Never commit secrets.** `.env*.local` stay gitignored; never `git add -f`.
- **Never weaken, skip, or delete a test** to get a green suite or a clean review. Fix the code or STOP with the conflict stated. **This matters more now than it did**: with no CI, the local gate is the only thing between a broken suite and `main`.
- **Never mark a story `done` on unverified work** — all tasks checked, lint+build+test clean **on the final head**, no open actionable feedback. Nothing enforces this externally, so re-run the gates after the close-out commit rather than trusting the run from before it.
- Only edit the story file in: Status, Tasks checkboxes, Dev Agent Record (Debug Log / Test Design / Completion Notes), **Review Findings**, File List, Change Log, and frontmatter `baseline_commit` + `merge_request`.
- Quote real output. If a step fails, surface it and stop.

## Workflow

**Input:** optional story id (`1.5`, `1-5`, `1-5-slug`) or file path.

### 0 — Preflight

`glab auth status` and `git` available. If `glab` is missing from PATH: `export PATH="$PATH:{glab_path}"`. Read `sprint_status` fully — order matters.

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
- **A story adding a gate must add it to the local gate** — a `package.json` script *and* the "Tested =" line under *Project facts*, so the next run inherits it. There is no CI to add it to. A gate nobody knows to run is not a gate.
- Pass `story_path` explicitly so its discovery menu never fires under `/loop`.
- Run `python3 _bmad/scripts/resolve_customization.py` as its Steps 1 and 11 instruct; hand-merge TOML only if it errors.
- **A HALT is a real halt** — ambiguous AC, untestable design, test/code conflict. Surface and STOP.

Then commit (trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`) and `git push -u origin story/{story_key}`.

### 4b — The local review, before the MR exists

**Two reviewers here, and CodeRabbit is not one of them.** Argus first, then `ocr`. CodeRabbit's
allowance is the scarce thing in this pipeline — measured at 4–5 reviews per hour, *per account,
across every repository*, and **a rate-limited request still spends an attempt**, so asking twice
lowers the ceiling you are waiting on. Spending it here leaves none for the merge request, where it
has found something real on every story it has reviewed. So it reviews the MR (Section 8) and
nothing else.

The first review still finds the most. Story 1.6b took 8 rounds and ~11 pushes; moving a first round
here took 1.6c and 1.6d to one each.

**One base for the whole step: local `main`, fast-forwarded at step 2.** Argus, `ocr` and the diff
checks all use it; mixing in `origin/main` means they score different diffs the moment anyone merges
upstream mid-round.

1. **`argus_review` first** (`git_range: main...HEAD`). Fix what it finds test-first, run 8e's
   *gate* on the fix diff — sensitivity check and test-value pass, not its push — and commit. Argus
   is free and it is the one that has caught the expensive defects: an outer-join predicate credited
   to the preserved side, a test file destroyed by a stray write, a NUL-guard test hollowed into
   passing on unrelated rows.
2. **`argus_review` again on that commit**, unless item 1 found nothing and nothing was committed.
   Later steps join reviews on commit SHA, and a review with no Argus run on it is skipped.
3. **Build the background, and keep it small.** `ocr` is materially better when told the invariants
   — blind, it missed a critical bug it found when given them. But `--background-file` **aborts the
   whole run above 8000 characters** and warns above 2000. A story file here is 10–20k, so pass the
   *story statement plus the acceptance criteria*, nothing else:

   ```bash
   python - <<'PY'
   import io
   src = '{story_file}'
   s = io.open(src, encoding='utf-8', newline='').read().replace('\r\n', '\n')
   story = s[s.index('## Story'):s.index('## Acceptance Criteria')]
   acs = s[s.index('## Acceptance Criteria'):s.index('## Tasks / Subtasks')]
   io.open('.argus/ocr-background.md', 'w', encoding='utf-8', newline='\n').write(story + acs)
   PY
   ```

   Trim further if it exceeds 2000 characters; the ACs matter more than the story statement.
4. **Preview before reviewing, and reconcile.** `ocr review --from main --to HEAD --preview` costs
   nothing and names exactly what will be read. Compare it against
   `git diff --name-only main...HEAD`. **If the preview is empty, stop — you are on the wrong
   branch.**
5. **Review.**

   ```bash
   ocr review --from main --to HEAD \
     --exclude '_bmad-output/**' \
     --background-file .argus/ocr-background.md \
     --format json --audience agent > .argus/ocr.json 2> .argus/ocr.err
   ```

   `--exclude '_bmad-output/**'` is not optional: `rule.json`'s `include` re-enables markdown, so
   without it the story document is reviewed *as a diff*, which is reviewing the prose against
   itself. It selected 11 files where CodeRabbit's path filter took 9.

6. **Exit 0 is not a review. Read the manifest.** Observed on 2026-08-21: a valid three-file
   selection produced **zero bytes of stdout and exit 0**, with only a warning on stderr. A retry of
   the same command worked, so the failure is transient — which makes it worse, not better, because
   it is the run that looks clean.

   Accept the review only when **all** of these hold:

   - `.argus/ocr.json` is non-empty and parses;
   - `manifest.terminal_state` is `complete`;
   - `manifest.coverage.failed` and `.waived` are empty;
   - `manifest.coverage.completed` covers every path in `manifest.coverage.selected`;
   - `selected` covers every path in the diff that `--exclude` did not remove.

   `summary.files_reviewed` is **not** evidence — it has reported 59 against 17 actually reviewed.
   The manifest is the artefact; the summary is a headline.

7. **Verify every finding against the real file before acting on it**, exactly as for any reviewer.
   Confirmed = the cited code exists, says what the finding claims, and the defect would manifest.
   Everything else is refuted and recorded as refuted — a reviewer's false-positive rate is a fact
   about the reviewer.
8. **Feed the confirmed findings back, so Argus learns what it missed.**

   ```bash
   node scripts/ocr-to-argus.mjs --in .argus/ocr.json --list
   node scripts/ocr-to-argus.mjs --in .argus/ocr.json --commit $(git rev-parse HEAD)      --confirmed 3,8 --reviewed-from main...HEAD --out .argus/ocr-review.jsonl
   ```

   then `argus_ingest` with `from: .argus/ocr-review.jsonl` and the same `commit`. **Without
   `commit` it silently learns nothing** — the stream has no SHA to join on, and an unjoinable
   review is skipped rather than reported.

   `--confirmed` is required by the adapter on purpose: `argus_ingest` writes everything in its
   input that Argus did not find to memory *as a miss*, so an unverified finding is not noise, it is
   a lesson teaching Argus to reproduce a false positive. **`--confirmed none` is legitimate** and
   is not the same as skipping the step: a review that ran and confirmed nothing is evidence, and a
   review that never ran is not.

   Note the vocabularies differ: `ocr`'s `medium` maps to `minor`, so with `argus_ingest`'s default
   severities (critical + major) most `ocr` findings are filtered out and nothing is learned. Widen
   `severities` when a confirmed `medium` is worth teaching.
9. Fix test-first, run the same gate, commit. Then `argus_review` on that fix commit, so the MR
   round has a SHA to join on.
10. **Push before Section 5** (*Merge request to main*). `glab mr create` builds the MR from the
   *remote* branch, so fix commits left unpushed are silently absent from it.

**What `ocr` is, measured rather than assumed.** On story 5.3, against the exact pre-fix commit
CodeRabbit reviewed, it found **none of the two findings it could have seen** — including a content
type left uncanonicalised, which would have made every browser-labelled CSV report as a format the
wizard cannot read. It found two others: one fair minor point about a short-circuit assertion, and
one runtime type-check suggestion on a boundary TypeScript already guarantees.

That is one story and a small sample, not a verdict. But do not treat this round as equivalent to
the CodeRabbit round it replaced: **it is a cheap extra pass, and Argus plus the MR round are what
the story actually rests on.** Cost, for the record: 754k tokens over 9 files in 1m46s; 195k over 3.

### 4c — The AC audit, before the MR

**For each acceptance criterion, name the test that would fail if the behaviour were removed — and show it would.** Record `path::case`, then for each either cite the round where its sensitivity was already proven or run the Step 9 check now: break the covered behaviour, confirm that case fails, restore.

A criterion you cannot name a test for is not implemented, whatever the code looks like. **And a name alone is not evidence** — a vacuous test satisfies "I named one" while staying green when the behaviour is deleted, which is the defect this project keeps finding. Naming without the sensitivity result makes the audit unfalsifiable by exactly the failure it exists to catch.

It has found something on **nine consecutive stories** — an AC read by the adapter, carried by the port and rendered by nothing; a URL parameter the page and its export read two different ways; and on 4.8 an AC nothing had implemented at all. It runs **here, not after the reviews**: on 3.8 that difference was a fix in the same branch versus a follow-up MR.

Cheap and mechanical. Do not skip it because the story felt thorough — that is the condition under which it keeps finding things.

### 5 — Merge request to main

1. Existing? `glab api "projects/{enc}/merge_requests?source_branch={branch}&state=opened&target_branch=main"`. Filter on the target: an open MR from this branch to anything else must **stop the run** — opening a second MR from the same source is worse. Report it and let the user close or retarget it.
2. Else write the description to a scratch file `{description_file}` and run `glab mr create --source-branch {branch} --target-branch main --title "{story_id}: {title}" --description "$(cat {description_file})" --yes`. **The body must come from a file** — backticks in a double-quoted bash string get command-substituted. `--title` is exposed the same way and is not file-backed: strip or escape backtick, `$`, `"` and `\` in `{title}` before interpolating it. `{description_file}` is a scratch path you choose, not `story_file` and not a literal `file`.
3. **Must target `main`.** The predecessor gate in step 2 and `bmad-implement-epic` both assume it; another target strands the story outside the epic's merge order.
4. Record `mr_iid`/`mr_url`, report the URL, and write `merge_request: {mr_iid}` into the story frontmatter — the epic loop uses it to verify the merge rather than trusting a status word.

### 6 — Local adversarial review: the **integration** pass

**Not the only review.** `_bmad/custom/review-gate.md` is the authoritative contract: **every diff that will reach `main` gets all three checks** — the sensitivity check, the test-value pass and the adversarial review — at each of three moments: each task's diff (Step 9 of `bmad-dev-tdd`), this whole-story pass, and **every review-fix push in Step 8e**. This line said "both checks" until CodeRabbit caught it on MR !71; three checks at three moments is a pair of threes, and naming one of them "both" is how a check gets quietly dropped. This step is what per-task reviews structurally cannot be: a look at the whole change at once, where an interaction between task 2's schema and task 3's write path is visible.

**This step is not optional and has been skipped before.** Stories 1.5c and 1.5d were implemented, gated and nearly shipped without it, with per-task mutation testing silently standing in for it. It does not stand in for it: on 1.5d the review found **four** defects after 29 mutations had found none of them, one of which showed "Reading" to a treasurer forever for a document that had been read.

Invoke **`bmad-code-review`** (not the lighter built-in `code-review`) on `baseline_commit..HEAD` (fallback `main...HEAD`), passing `story_file` as the spec for **`full`** mode. It writes to the story's `### Review Findings` — the audit trail. State the scope you reviewed and anything you excluded; the story document is the spec and reviewing it as a diff reviews the prose against itself.

**Verify every finding against the real file before acting on it** (`_bmad/custom/argus-review-routing.md` §5). The engine reasons from a token-budgeted slice and can cite code it only partly saw. On 1.5d that discipline sharpened one finding's mechanism and turned another from a patch into a decision for the user.

Under `/loop` choose **Apply every patch**; surface and STOP on anything needing a human call. Fix **test-first** — a review fix without a regression test is moved, not fixed. Re-run the gates, commit, push.

**Look hardest at guards that prove nothing** — a check that passes whether or not the thing it guards against is present. Ten found on this project: a bare `rejects.toThrow()` that also passes when the table is absent; a loop over an empty list; a `Promise.all` "concurrency" test that passed against a deliberately racy implementation; a `requestTimeout` that only logged a warning. Tool: the `bmad-dev-tdd` Step 9 sensitivity check — break the covered code, confirm the test fails, restore.

### 7 — Verify the head, locally

Run `{gate}` — the whole of it — **on the exact head the MR points at**. Not the run from before the close-out commit: that was a different head.

**Where `{ci}` is none, this run is the only evidence that head is green.** There is no second opinion and no external record, so an unrun check is simply an unmade claim. Do not wait for a pipeline, report its status, or treat its absence as a failure.

Report it as what it is: "gates green locally on `<sha>`".

### 8 — CodeRabbit loop (the `/loop` tick)

**8a. Request, then wait.** Where `{review_trigger}` is manual, **no review happens until it is asked for** — time the wait from *your request*, not from `created_at` or the push. A review takes ~20 min on a new MR, ~4 after a fix push; checking earlier cannot succeed. Under `/loop` that wait is the next `ScheduleWakeup`; standalone, say when the review is due and STOP.

**On waking, before reading anything:** confirm the MR is still `opened` and its `sha` is still yours. A merge can land while you sleep — that happened on story 1.5 — and 8e would then push fixes to a branch about to be deleted. If either changed, stop and move any unmerged commits to a fresh branch and MR.

**8b. Read the review.** CodeRabbit posts as a **service account** (`{reviewer_account}`), not a name containing "coderabbit" — filtering on the name finds nothing and looks like "no review yet". Fetch `.../merge_requests/{iid}/notes?per_page=100&sort=desc` and match **`Actionable comments posted: N`**; that line is the review. Threads from `.../discussions`. Only trust one whose commit matches the current head.

`per_page=100` is **one page** — story 1.5's MR reached 64 notes, and replies push a review down fast. Follow `X-Next-Page` until the current-head review is found or the pages run out. Concluding "no review" from page one is the same absence-of-evidence error in a new place.

A review announces itself in **four** shapes. Match all of them, and read the note body rather than trusting its first line:

| Shape | Means |
| --- | --- |
| `Actionable comments posted: N` | N findings |
| **`No actionable comments were generated`** | **reviewed and clean — this is how convergence actually arrives** |
| `Duplicate comments (N)` | an incremental re-review of repeats; carries **no** actionable line |
| `Outside diff range comments (N)` | findings that could not be posted inline |

The clean shape is the one that matters most: keying only on `Actionable comments posted:` means a clean MR **never converges** and the loop waits forever for a line that is never coming. That happened on MR !8 — reviewed clean in 24 seconds, reported as "awaiting review" for an hour.

**A clean re-review can arrive as an *edit*, not a new note.** CodeRabbit updates its existing summary comment in place, so a poll that only looks for new notes sees nothing and waits forever. Match on the body and on `updated_at`, not on note id or position.

A note is a review only if it carries a `Commits` / `Files selected for processing` block. The **summary comment** (`<!-- … summarize by coderabbit.ai -->`) does not, and carries no findings. Do not treat a stray `rate limited` string as proof either — it appears in stale fragments of otherwise-complete reviews. A **live** refusal is its own note, posted within seconds of the request, and says which: `Review rate limited`, or `Head commit changed`.

**8c. Convergence.** Precondition: a service-account review matching the current head, in any of 8b's four shapes. Without it nothing below applies — "zero unresolved threads" and "no review yet" are both true *before* any review, so a predicate lacking this precondition reports a never-reviewed story clean. An earlier version of this file did.

Converged = the local gates green on the current head AND every finding **fixed** (push → new head → back to 8a), **skipped** with a reason on its thread, or **resolved by CodeRabbit**. Anything else is pending — including a review still missing after the wait.

**8d. Triage.** Fix real correctness/security/accessibility issues. A finding that asks you to weaken one of `{invariants}` is an architecture decision for the user, not a fix — route it there and say so. **Verify factual claims first** — read the installed types, run the probe, grep the config; CodeRabbit correctly caught that `requestTimeout` doesn't bound socket idleness, and in the same round wrongly asserted the repo runs markdownlint. Skip low-value nits with a written reason, preferably recorded in the code or migration itself.

**8e. Apply — one commit and one push per round.** Fix **every** finding in the round first, then **run the review gate on the whole round's diff before pushing** — sensitivity check, **test-value pass**, and one `argus_review` scoped to what the round touched (`_bmad/custom/review-gate.md`). Then **one** commit, **one** push.

**A push does not trigger a review.** Where `{review_trigger}` is manual it never does; where it is automatic, CodeRabbit still pauses after `auto_pause_after_reviewed_commits` (`{auto_pause}` here, default 5) and stays paused until asked. Either way the rule is the same: **after every push, request a review and then confirm a review body exists for the current head.** An unrequested MR, a paused branch and a clean review are indistinguishable from outside — the false-clean 8c exists to refuse.

Post it with `glab mr note create`, never `glab api --field`: a body starting with `@` is read as a filename and the request silently posts nothing. `@coderabbitai review` covers the latest changes; `@coderabbitai full review` re-reviews everything.

**Not a commit per finding.** Story 1.6b answered 4 rounds with 12 commits, and each one cost a re-review and a place in CodeRabbit's `auto_pause_after_reviewed_commits` budget — it paused itself mid-story twice, which from outside is indistinguishable from a clean review. Batching also gives the reviewer the round as one diff, which is how a fix that breaks a sibling fix becomes visible; on 1.6b two such defects were found only because something looked at the fix diff whole.

Keep the reasoning that would have gone in several messages — write it as sections of one commit body rather than losing it.

The test-value pass matters most *here*, because a fix diff is where a test's premise expires. `python3 _bmad/scripts/tests_touched.py <range>` lists the cases the fix touched; for each, ask **vacuous?** and **expired?**

- **Vacuous** in *two* directions, and breaking the code only finds one. Break the **code** it covers — still green means it proves nothing. Then break the **fixture**: change the input so the expected outcome must change, leaving the code and the expected value alone — still green means the *input* was satisfying the assertion, not the code. Restore it and re-run before moving on; a mutated input left in the diff reads as a real test case. Story 4.8 shipped four of the second kind and the sensitivity check caught none: `toContain('12')` against an amount of `1240.00`; two reads of an unchanged table asserted to agree; an assertion restating its neighbour; a cap on an input that never reached it. A reviewer found all four.
- **Expired** — does it assert something a later decision made wrong? A mutation is blind to this: an expired test fails loudly when you break the code, so it looks healthy. Story 1.5d shipped two, each blocking the fix it should have driven. Then check what *lost* cover — re-specifying a test can strip the only assertion from a behaviour that is still correct, and the suite goes greener, so nothing complains.

**A fix is the highest-risk diff in the story, not the lowest.** On story 1.5d, rounds 2 and 3 produced **8 findings and every one was in a fix from a previous round** — a swallowed 404, a stale read that reintroduced the bug it was fixing, a `NULL` token written against a check constraint. Fixes are written under time pressure, against a narrower model, on machinery with invariants already in place. Skipping the gate here is skipping it where it pays most.

**8e-close. The close-out rides in the round's commit, not after it.** Story `Status: done`, Change Log entry, `development_status[{story_key}] = done` + `last_updated`, and the round's Review Findings — all in the **same commit and push** as the round's fixes. Not a commit of its own once the review comes back clean.

Because a story with no fixes this round still has a round: if the review was clean and nothing needed changing, the close-out *is* the commit.

**Why: a close-out pushed after convergence races the merge, and loses.** You announce ready-to-merge, the user merges the head they were shown, and the close-out lands on the branch behind them — so `main` keeps `Status: review`. Step 1 then picks the *finished* story again instead of the next one. That has needed a follow-up docs MR five times: stories 2.1, 2.6, 2.7, 3.2 and 4.4 (MR !57).

Marking `done` before the final review returns is safe because **8c still decides convergence** and 9.3 already specifies the undo. `done` on an unmerged branch means ready-to-merge, and a further round simply amends it.

**8f. Reply per thread** — Fixed (what changed) or Skipped (why). **Write bodies to files** and post with `--field "body=$(cat file)"`.

**Caps:** ~3–4 rounds; only-already-skipped findings recurring counts as converged.

**On a rate limit, wait half of `{review_window}` and re-request.** The window is *rolling*, so capacity returns gradually as the oldest request ages out rather than all at once; half is a probe, not a guarantee. Still limited → wait another half. **Never push to force a review**: a push spends nothing and resets nothing.

**"Head commit changed" is a different failure and needs no wait.** The request was voided because the branch moved between asking and processing — which a force-push will do to you. Re-request once the head is settled, and check local, remote and MR heads agree before asking again.
### 9 — Ready-to-merge (terminal)

1. **The docs are already pushed** — 8e-close put them in the round's commit. Confirm rather than write: story `Status: done`, Change Log entry, `development_status[{story_key}] = done` + `last_updated`, and `epic-{N} = done` if this was the epic's last not-`done` story (otherwise `in-progress` if unset). **If any is missing, this step is the bug** — commit and push it now, and expect step 2 to cost a re-review.
2. **Verify on the exact head the MR points at.** No new push means the Step 7/8 evidence still stands; re-run the gates anyway, because with no pipeline that run is the *whole* of the evidence. If you did have to push in step 1, re-run 8e's gate on the new head — a docs-only push is still a diff that reaches `main`.
3. **If verification fails, undo the status before stopping.** Restore the story to `Status: review`, restore `development_status[{story_key}]` and any `epic-{N}` change, commit and push, then STOP with the failure. A story left reading `done` on a red head both breaks the hard rule above and makes `bmad-implement-epic` skip it, since the loop iterates only over not-`done` stories.
4. **Confirm the MR is still open at your head** before reporting.
5. Report MR URL, review outcome, and the **local gate results on the final head** — naming them as local, since no pipeline corroborates them. Then **"Ready to merge — leaving the merge to you."**
6. STOP.

**`done` means ready-to-merge, not merged** — it is written on an unmerged branch. Nothing downstream may treat it as proof of a merge.

## Stacking (exception, on request only)

If the user wants to keep building without merging, branch off the previous *story* branch and say in the MR description that the diff includes the parent. Default is to wait — stacking reintroduces the reviewability problem this design removes.

## Driving with /loop

`/loop ship story {id}`. One tick runs 0–7, opens the MR, requests a review and **ends at a scheduled wait** — the MR reviewer is asynchronous, so the tick that asks is not the tick that reads. Under `/loop` choose **Apply every patch** in Section 6, and STOP on anything needing a human call.

**Time the wait from the request, not from the push** (8a): ~20 minutes on a new MR, ~4 after a fix push. Waking early cannot succeed and spends a tick. The local round in 4b is synchronous and needs no wait; only Section 8 does.

## Project bindings

**Everything project-specific is in this block.** Porting this skill to another repository means editing the table and the two lists below it — the workflow above refers to them by name and contains no other repo-specific value.

| Binding | This project |
| --- | --- |
| `{project}` | `ageem123/hoa-treasurer-assistant` |
| `{project_encoded}` | `ageem123%2Fhoa-treasurer-assistant` |
| `{glab_path}` | `/c/Users/magee/AppData/Local/Programs/glab` |
| `{ocr}` | `ocr` **v1.9.8** on PATH, configured for OpenRouter with `qwen/qwen3.7-plus`; config and `rule.json` in `~/.opencodereview/`. Runs natively on Windows — no WSL. `--background-file` **aborts above 8000 characters** and warns above 2000. `rule.json`'s `include` re-enables markdown, so `--exclude '_bmad-output/**'` is required or the story document is reviewed as a diff |
| `{repo_path_wsl}` | `/mnt/c/Users/magee/repos/HOA-Treasurer-Assistant` — **no longer used by this workflow.** The CodeRabbit CLI (Linux/macOS only, 0.7.3 at `~/.local/bin/coderabbit`) ran here until 2026-08-21, when the local round moved to `ocr` to keep the CodeRabbit allowance for the MR. Kept because the CLI is still the fastest way to get a second opinion by hand |
| `{reviewer_account}` | `service_account_group_138854092_3007818568fc4619843ba9be06214ec5` — **complete, never abbreviated**: it is matched against the note author, so a truncated value matches nothing, a real review reads as "no review", and 8c waits forever. It was an illustration in prose before it was a binding. |
| `{auto_pause}` | 25 |
| `{review_window}` | **1 hour, rolling, and the allowance is per *account*, across every repository connected to it** — another project's reviews spend this one's window, so an MR's own history tells you nothing about what is left. **The plan changed on 2026-08-20** from Free/OSS to a paid subscription, so the old measured figures (3 CLI reviews/hr; rate-limited at 21:54, a re-request 50 min later succeeded) no longer describe this account. **Re-measure before relying on a number** — and treat a rate limit as evidence, not the absence of one as proof of headroom. |
| `{review_trigger}` | **automatic, measured 2026-08-21.** On MR !71 a push at 02:08:56 drew a review at 02:09:12 — sixteen seconds, with no request before it; the manual `@coderabbitai review` went out at 02:09:37, *after*. So **do not request one as a matter of course**: it is redundant, and it spends the rate-limit budget the automatic review needs. CodeRabbit's own refusal says as much — *"this command is applicable only when automatic reviews are paused"*. Request explicitly only when a push has drawn no review after 8a's wait, or when the branch is paused by `{auto_pause}`. This binding read **manual** for its first hour, which is what produced two rate-limited requests in one session. Still confirm a review body exists for the current head: automatic and merely-not-yet-arrived look identical from outside. |
| `{ci}` | **none** — removed 2026-08-07, per-minute billing (AD-2's amendment). `.github/workflows/ci.yml` is vestigial |
| `{tsc_baseline}` | 8 pre-existing errors |

**`{gate}` — what "tested" means here.** Every command, every time; a partial run is an unmade claim.

- `npm run lint` + `npm run build` + `npm test`
- `npm run test:db` for schema, adapter or `app/tools/` work. It runs *nowhere* unless someone runs it, which makes AD-4's SELECT-only proof and AD-13's idempotency constraints locally-verified only
- `npm run test:py` for anything under `agent/` **or for the gate itself** — `scripts/run-pytest.mjs` and the `test:py` script define it, so changing them without running it is the one edit that can silently disable a gate. It runs pytest on the pinned 3.13, never the ambient 3.14: CrewAI's `requires_python` is `<3.14,>=3.10`, so AD-15 pins it and `agent/.venv` is built with it. The script refuses rather than falling back, because a gate on the wrong runtime reports green from an environment CrewAI cannot be installed into
- `npx --no-install tsc --noEmit`, compared against `{tsc_baseline}`. Neither ESLint nor Vitest type-checks and `npm run build` skips test files, so this is the only thing that sees them — it caught real errors in three consecutive stories that lint and build both passed

**`{invariants}` — what a review may not trade away.** A finding asking you to weaken one is an architecture decision for the user, not a fix.

- NFR-2/AD-2 — no banking, payment-rail or external-accounting credential anywhere (`core/security/nfr2-guard.test.ts`)
- AD-4 — the reader database role is SELECT-only
- AD-13 — content-hash idempotency is a database constraint
- `core/` imports nothing outward (`core/ports/boundary.test.ts`)

**Repo hygiene.** Committed: `_bmad-output/`. Ignored: `.claude/` except tracked skills, `.agents/`, `_bmad/`, `node_modules/`, `.next/`, `.probe/`, `envprobe`, `.env*.local`. Benign: Git's CRLF warnings.

## Practice — portable

These hold in any repository and travel with the skill unchanged.

- **Status flow:** `backlog → ready-for-dev → in-progress → review → done`. `baseline_commit` defines the review diff range.
- **Two looks per story, by different reviewers.** 4b sees the story whole before anyone else has; Section 8 sees the fixes. Neither is the whole review — on story 5.1b the MR round raised ten findings against code Argus had already passed twice, including a scoping guard satisfiable by SQL inside a comment.
- **The reviewers are not interchangeable, and the split is about scarcity.** Argus is free and has caught the expensive defects. `ocr` is cheap and, measured on story 5.3, missed both of the findings CodeRabbit caught on the same commit. CodeRabbit is the strongest and the most rationed, so its one review goes to the merge request. Read 4b's closing note before treating `ocr`'s silence as a clean bill.
- **A reviewer's output is a second opinion to verify, never ground truth.** CodeRabbit's was once ingested unverified. In one round it correctly caught that `requestTimeout` does not bound socket idleness and wrongly asserted the repo runs markdownlint; in another it named the wrong migration. Confirm each finding against the real file before acting on it or feeding it to `argus_ingest`, which turns a false positive into a lesson.
- **Any scripted edit is read back afterwards.** Not "be careful with heredocs" — that rule existed and was broken anyway. An anchored replacement whose assertion fails is a change that did not happen: one was reported as fixed on a review thread and the reviewer's next round caught it. Verify the **replacement**, not just the presence of new text: a grep for the new string passes when that string already existed elsewhere, or when the old text is still sitting at the target. Check the old text is gone and the match count is what you expected.
- **Shell gotchas:** backticks inside double-quoted bash strings are command-substituted (write bodies to files); `glab api --field "body=$(cat f)"` **fails if the body starts with `@`** — glab reads a leading `@` as a filename and errors with "The filename, directory name, or volume label syntax is incorrect", or silently posts nothing; use `glab mr note create` for any body that could start with one; PowerShell here-strings don't work in the Bash tool; `git show origin/branch:path` is mangled by Windows path conversion (use `git cat-file -p <blob>`); run one test file with `npm test -- <substring>`, never `npx vitest run` (fails here, and `npx` fetches unpinned packages); never `npx prettier` — no config, and its defaults fight the house style.
