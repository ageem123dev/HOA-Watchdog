---
failed_layers: '' # set at runtime: comma-separated list of layers that failed or returned empty
review_engine: '' # set at runtime: "argus" or "claude"
argus_meta: '' # set at runtime: structuredContent from argus_review, when the engine was argus
---

# Step 2: Review

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- All review subagents must run at the same model capability as the current session.
  This governs the **Claude subagent layers** only. The Argus engine reasons through a
  different model family on purpose — that is the point of a second opinion.
- `_bmad/custom/argus-review-routing.md` is loaded as a persistent fact on activation and
  is the authoritative contract for engine selection, the call shape, cost limits, and the
  verification duty. If this file and that one ever disagree, that one wins.

## INSTRUCTIONS

### 0. Select the review engine

Read `BMAD_REVIEW_ENGINE`. Unset or empty means `argus`.

- `claude` → skip to instruction 1 and run the subagent layers as written. Set
  `{review_engine}` = `claude`.
- `argus` → run section 0a. Set `{review_engine}` = `argus`.
- `both` → run section 0a, then instructions 1–3 as well, and carry both result sets
  into triage.

Announce the engine before reviewing.

### 0a. Argus review

Make **exactly one** `argus_review` call for this review scope — never one per file, never
in a loop. See the routing contract for why (~20k+ tokens per call).

```
argus_review(
  repo_root: "c:/Users/magee/repos/HOA-Treasurer-Assistant",
  project:   "HOA-Treasurer-Assistant",
  diff:      {diff_output},
  provider:  "antigravity",
  refine:    true,
  verify_with_tools: true
)
```

`repo_root` is mandatory — its default (`"."`) resolves against the MCP server's working
directory and would silently review a different codebase. Pass `{diff_output}` as `diff`
rather than a `git_range`, so Argus reviews exactly the scope confirmed at step 1's
checkpoint, including any chunking the user agreed to.

Store `structuredContent` in `{argus_meta}`. The `verdict` field carries the full review
narrative and is the source of the findings; it is not a one-word status.

**Handle the outcomes:**

- `isError` with `The diff is empty` → nothing to review. HALT and tell the user. This is
  not a failure and must not trigger a fallback.
- `isError` with `Governance blocked the review` → report the reason verbatim, then fall back.
- Any other `isError`, a timeout, or the tool being unavailable → report it, then fall back.
  (`.mcp.json` needs a Claude Code restart before the server connects.)
- `structuredContent.audit_chain_ok` is `false` → the audit trail is broken. Report it,
  discard the result, and fall back.

**Fall back** = set `{review_engine}` = `claude`, say plainly that Argus was unavailable and
why, then run instructions 1–3. Never fail the workflow because Argus was unreachable, and
never announce a clean review when no engine produced one.

On success, proceed to step 3. Do not run the subagent layers unless the engine is `both`.

1. If `{review_mode}` = `"no-spec"`, note to the user: "Acceptance Auditor skipped — no spec file provided."

2. Launch Blind Hunter and Edge Case Hunter in parallel without prior conversation context. If `{review_mode}` = `"full"`, include the Acceptance Auditor in the same parallel launch. If subagents are not available, generate prompt files in `{implementation_artifacts}` for each applicable reviewer role and HALT. Ask the user to run each in a separate session (ideally a different LLM) and paste back the findings. When findings are pasted, resume from this point and proceed to step 3.

   - **Blind Hunter** — prompt:
     > Invoke the `bmad-review-adversarial-general` skill on this diff:
     >
     > {diff_output}

   - **Edge Case Hunter** — prompt:
     > Invoke the `bmad-review-edge-case-hunter` skill on this diff:
     >
     > {diff_output}

   - **Acceptance Auditor** (only if `{review_mode}` = `"full"`) — prompt:
     > You are an Acceptance Auditor. Review the provided diff against `{spec_file}` and any loaded context docs. Check for: violations of acceptance criteria, deviations from spec intent, missing implementation of specified behavior, contradictions between spec constraints and actual code. Output findings as a Markdown list. Each finding: one-line title, which AC/constraint it violates, and evidence from the diff.
     >
     > Diff:
     > {diff_output}

3. **Subagent failure handling**: If any subagent fails, times out, or returns empty results, append the layer name to `{failed_layers}` (comma-separated) and proceed with findings from the remaining layers.

4. Collect all findings from the completed layers.


## NEXT

Read fully and follow `./step-03-triage.md`
