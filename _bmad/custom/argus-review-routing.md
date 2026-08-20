# Argus review routing

Authoritative contract for how `bmad-code-review` obtains its findings.

This file is loaded as a persistent fact by `_bmad/custom/bmad-code-review.toml`, so it
survives BMad reinstalls and updates that overwrite `.claude/skills/bmad-code-review/`.
The step files carry a short pointer to this file; **this file wins** if they ever disagree.

---

## 1. Engine selection

| `BMAD_REVIEW_ENGINE` | Behaviour |
| --- | --- |
| unset or `argus` | Argus via MCP, falling back to the Claude subagent layers on failure |
| `claude` | Claude subagent layers only — Argus is not called at all |
| `both` | Argus **and** the Claude subagent layers, merged in triage |

Read the variable with `[System.Environment]::GetEnvironmentVariable('BMAD_REVIEW_ENGINE')`
(PowerShell) or `printenv BMAD_REVIEW_ENGINE` (Bash). An unset or empty value means `argus`.

Announce the engine before reviewing: `Review engine: argus (MCP)` or
`Review engine: claude (subagents)`. When a fallback fires, say so and say why.

`both` is the most thorough setting and costs the most. It is not the default because the
Claude layers and Argus overlap heavily on a story-sized diff.

## 2. The Argus call

**Exactly one `argus_review` call per review scope.** Never per file, never in a loop. The
`agy` backend pays ~10–18k input tokens of agent scaffolding per call, so even a trivial
diff costs ~20k+ tokens. Re-reviewing after fixes is a new scope and a legitimate second
call; iterating over files is not.

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

### `repo_root` is mandatory and is this project

Its schema default is `"."`, which resolves against the **MCP server process's** working
directory — not this repo. Omitting it silently reviews the wrong codebase and reports
success. Always pass the absolute path above. Never pass the Argus repo.

### A `diff_file` path must be Windows-absolute

`diff_file: "/tmp/task1.diff"` **silently reviews something else.** The path is resolved by the
MCP server process, not by the shell that wrote the file, so a POSIX path Git Bash maps to
`C:\tmp\` does not necessarily land there. What comes back is not an error: on story 5.1b's task 1
it was a confident, well-written, `audit_chain_ok: true` review of `core/ports/finding-reader.ts`
and `checked-documents.ts` — epic-4 files, absent from the diff entirely. Re-running the identical
call with `C:/tmp/task1.diff` reviewed the real change.

Write the file to a Windows-absolute path and pass it as one. **Then check the verdict names files
that are actually in your diff** before reading a word of its judgement — `files_discovered` should
be in the region of your file count, and this is the same silent-wrong-target shape as the
`repo_root` default above.

### Pass `diff`, not `git_range`

Step 1 has already constructed `{diff_output}`, validated it non-empty, shown its stats at
a checkpoint, and possibly **narrowed it** — a diff over ~3000 lines can be chunked to one
file group by user agreement. `git_range` would make Argus re-derive the diff from git and
review the whole range, silently exceeding the scope the user approved. `{diff_output}` is
the authoritative scope.

Use `git_range` only when invoked without step 1 having run (automation entry points),
mapping the scope as:

| Scope | `git_range` |
| --- | --- |
| Staged changes only | `--staged` |
| Uncommitted (staged + unstaged) | `HEAD` |
| Branch diff vs base | `<base>...HEAD` |
| Commit range | the range verbatim |
| Story under `bmad-ship-story` | `{baseline_commit}..HEAD`, else `main...HEAD` |

`repo_root` is still required when passing `diff` — Argus gathers its repo context and runs
its verifiers there.

### `provider`

- `antigravity` — the default. One `agy` call per review.
- `offline` — no network, canned output. Use to test wiring without spending tokens.
- `antigravity-shim` — same backend, ~20 calls, **~20x the cost for the same result**. Only
  on explicit user request.
- `anthropic` — needs `ANTHROPIC_API_KEY`. Not used by this project's review path.

## 3. Reading the result

Gate on `structuredContent`, not on the prose.

`verdict` is the **entire review narrative**, not a one-word status. It is the source of the
findings. `complexity`, `confidence`, and the perception counts are metadata about how much
weight the narrative has earned.

Checks before using the findings:

- `audit_chain_ok === false` → the audit trail is broken. Report it, discard the result, and
  fall back to the Claude layers.
- `files_selected` of `files_discovered` at a low `selectivity` → Argus saw a thin slice.
  Say so in the summary; it raises the bar for verification in section 5.
- `reflection_converged === false` → the self-critique loop did not settle. Note it.
- `blocked` is **always `false`** here. Governance blocks arrive as `isError` (section 4),
  never as a structured field, so gating on it accomplishes nothing.

Report the metadata line in the review summary:

> Argus: `<verdict-word>` · complexity `<complexity>` · confidence `<confidence>` ·
> context `<files_selected>/<files_discovered>` files · `<agy_calls>` agy call(s),
> `<agy_tokens>` tokens

## 4. Failure handling

| Condition | Action |
| --- | --- |
| `argus_review` not available in this session | Fall back to Claude layers. Note that `.mcp.json` needs a Claude Code restart to connect. |
| `isError` — `The diff is empty` | **Not a failure.** Nothing to review; HALT and tell the user, exactly as step 1 does for an empty diff. Do not fall back and do not re-run. |
| `isError` — `Governance blocked the review` | Report the reason verbatim, then fall back. |
| `isError` — anything else, or a timeout | Report it, then fall back. |
| `audit_chain_ok === false` | Report it, then fall back. |

A fallback runs the Claude subagent layers from step 2 as originally written and continues
the workflow. Never fail the flow because Argus was unreachable, and never report a review
as clean when the engine never produced one.

## 5. Verification is mandatory before any finding is acted on

Argus reasons from a token-budgeted context slice. It can cite a line it only partially saw,
attribute code to the wrong file, or describe a guard that already exists just outside its
slice. **Its output is a second opinion to check, not ground truth.**

Before assigning severity, open the real file at each finding's location and read enough
surrounding code to judge it — call sites, guards, and validation outside the diff hunk.
Then label every Argus finding with exactly one status:

- **confirmed** — the code says what Argus says it says, and the consequence is real.
- **not-reproduced** — the cited location does not contain the described problem, the line
  reference does not resolve, or the guard Argus says is missing is present.
- **disagree** — the code is as described, but the reasoning about its consequence is wrong
  (unreachable, already handled downstream, intended behaviour).

Rules:

- Only **confirmed** findings may become `patch` or `decision_needed`.
- **not-reproduced** and **disagree** route to `dismiss`, but they are **never silently
  dropped** — each is listed with its one-line reason in the presentation step.
- A finding whose location cannot be resolved to a real file and line is **not-reproduced**
  by definition. Do not re-derive a plausible location for it.
- Severity is assigned here, from the real code. Argus's `confidence` informs how hard to
  look; it does not set severity.

## 6. Invariants Argus does not know about

Argus reviews from repo context, not from this project's architecture decisions. A finding
that asks to weaken any of the following is an **architecture decision for the user**, not a
patch — route it to `decision_needed` (or `defer` in `no-spec` mode), never auto-apply:

- **NFR-2 / AD-2** — no banking, payment-rail, or external-accounting credential anywhere
  (`core/security/nfr2-guard.test.ts`, `core/security/forbidden-credentials.test.ts`)
- **AD-4** — the reader database role is SELECT-only
- **AD-13** — content-hash idempotency is a database constraint
- `core/` imports nothing outward (`core/ports/boundary.test.ts`)

Never weaken, skip, or delete a test to resolve an Argus finding.
