---
---

# Step 3: Triage

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`

## INSTRUCTIONS

1. **Normalize** findings into a common format. Expected input formats:
   - Adversarial (Blind Hunter): markdown list of descriptions
   - Edge Case Hunter: JSON array with `location`, `trigger_condition`, `guard_snippet`, `potential_consequence` fields
   - Acceptance Auditor: markdown list with title, AC/constraint reference, and evidence
   - Argus (`{review_engine}` = `argus`): free-form review narrative in the `verdict` field
     of `{argus_meta}`. Split it into discrete findings — one per distinct problem raised.
     A narrative that raises no problem yields zero findings; do not manufacture one from
     approving prose, and do not merge several distinct problems into one finding.

   If a layer's output does not match its expected format, attempt best-effort parsing. Note any parsing issues for the user.

   Convert all to a unified list where each finding has:
   - `id` -- sequential integer
   - `source` -- `blind`, `edge`, `auditor`, `argus`, or merged sources (e.g., `blind+edge`)
   - `title` -- one-line summary
   - `detail` -- full description
   - `location` -- file and line reference (if available)
   - `verification` -- `confirmed`, `not-reproduced`, or `disagree` (set in instruction 3a)

2. **Deduplicate.** If two or more findings describe the same issue, merge them into one:
   - Use the most specific finding as the base (prefer edge-case JSON with location over adversarial prose).
   - Append any unique detail, reasoning, or location references from the other finding(s) into the surviving `detail` field.
   - Set `source` to the merged sources (e.g., `blind+edge`).

3. **Read the code before rating.** Before assigning severity, open the source at each finding's location and read enough surrounding code to judge reachability -- call sites, guards, and validation that live outside the diff hunk. Do not rate from the diff hunk alone. Severity reflects the real consequence at a real call site, not the worst theoretical reading.

3a. **Verify every finding against the real file.** This is mandatory for `argus`-sourced
   findings and good practice for all of them. Argus reasons from a token-budgeted context
   slice — it can cite a line it only partially saw, attribute code to the wrong file, or
   report a missing guard that exists just outside its slice. Its output is a second opinion
   to check, not ground truth. A low `selectivity` in `{argus_meta}` means a thin slice and
   raises the bar here.

   Set `verification` on each finding to exactly one of:

   - **confirmed** — the code says what the finding says it says, and the consequence is real.
   - **not-reproduced** — the cited location does not contain the described problem, the
     line reference does not resolve, or the guard said to be missing is present.
   - **disagree** — the code is as described, but the reasoning about its consequence is
     wrong: unreachable, handled downstream, or intended behaviour.

   Rules:
   - Only **confirmed** findings may be routed to `patch` or `decision_needed` in step 5.
   - **not-reproduced** and **disagree** are routed to `dismiss`, each with a one-line
     reason. They are reported in step 4, never silently dropped.
   - A finding whose location cannot be resolved to a real file and line is
     **not-reproduced** by definition. Do not invent a plausible location for it.
   - Argus's `confidence` informs how hard to look. It does not set severity.

3b. **Architecture invariants are not patches.** A finding that asks to weaken NFR-2/AD-2
   (no banking, payment-rail, or external-accounting credential), AD-4 (reader role is
   SELECT-only), AD-13 (content-hash idempotency as a DB constraint), or `core/`'s outward
   import ban is an architecture decision for the user. Route it to `decision_needed`
   (`defer` in `no-spec` mode). Never auto-apply it, and never weaken or delete a test to
   resolve it. Argus has no knowledge of these decisions.

4. **Assign severity** to each finding by consequence for the artifact's main consumer (software user, document reader, etc).
   Disregard any severity assigned by a reviewing subagent. Review subagents operate under by-design information asymmetry and do not have enough context to set final severity for this workflow.
   - `low` -- none or cosmetic
   - `medium` -- tolerable
   - `high` -- intolerable

5. **Route** each finding into exactly one triage bucket:
   - **decision_needed** -- There is an ambiguous choice that requires human input. The code cannot be correctly patched without knowing the user's intent. Only possible if `{review_mode}` = `"full"`.
   - **patch** -- Code issue that is fixable without human input. The correct fix is unambiguous.
   - **defer** -- Pre-existing issue not caused by the current change. Real but not actionable now.
   - **dismiss** -- Noise, false positive, or handled elsewhere. Every finding whose
     `verification` is `not-reproduced` or `disagree` lands here, regardless of how
     serious it would have been if true.

   If `{review_mode}` = `"no-spec"` and a finding would otherwise be `decision_needed`, reclassify it as `patch` (if the fix is unambiguous) or `defer` (if not).

6. **Drop** all `dismiss` findings from the actionable list. Record the dismiss count for the summary, and **retain the `not-reproduced` and `disagree` findings with their reasons** — step 4 reports them.

7. If `{failed_layers}` is non-empty, report which layers failed before announcing results. If zero findings remain after dropping dismissed AND `{failed_layers}` is non-empty, warn the user that the review may be incomplete rather than announcing a clean review.

   When `{review_engine}` = `argus`, apply the same caution to a thin context slice: if
   `{argus_meta}` shows a low `selectivity`, or `reflection_converged` is `false`, say so
   alongside the result rather than presenting it as a settled verdict.

8. If zero findings remain after triage (all rejected or none raised): state "✅ Clean review — all layers passed." (Step 3 already warned if any review layers failed via `{failed_layers}`.) When `{review_engine}` = `argus`, name the engine in that line — a clean Argus review and a clean three-layer review are not the same claim.


## NEXT

Read fully and follow `./step-04-present.md`
