---
Status: ready-for-dev
baseline_commit:
merge_request:
---

# Story 5.6b — the model earns the residue

## Story

**As** a treasurer whose export uses column names nobody could have guessed,
**I want** the setup wizard to ask a model about the columns it could not match itself,
**so that** I am not left hand-pairing a file that a person would have read at a glance —
**and** the wizard still works exactly as it does today when the model is unreachable.

## What story 5.6 already built, and what is left

Story 5.6 (merged, MR !83) shipped the deterministic half **and the whole structural boundary**:

- `core/mapping/heading-match.ts` — case, punctuation and an alias table; matches the large majority.
- `core/mapping/suggest.ts` — the **`ColumnSuggester` port**, `suggestColumns` (the deterministic
  implementation), and the caps `MAX_SUGGESTIBLE_HEADINGS` (256) and `MAX_HEADING_LENGTH` (128).
- `core/mapping/prefill.ts` — `draftFromSuggestion`, folding `assign`.
- `app/onboarding/mapping/column-pairing.tsx` — the marker, the summary line, and the
  **no-suggester case**, which is a supported state rather than a degraded one.

**This story writes one adapter and changes one line of wiring.** The port exists, its bounds exist,
its structural tests exist, and `mapping-wizard.tsx` names `deterministicSuggester` at a single call
site. If this story finds itself widening the port, the port is wrong — say so and stop.

## Where the model may live, decided before any code

This is the story's one real decision and the architecture already settles most of it.

### It may not be the reasoning agent. AD-10 forbids it outright

> **AD-10:** *"Raw document bytes and raw extracted text never enter the reasoning agent's context
> window under any code path."*

Column headers are raw extracted text out of a user-supplied file. That is not a judgement call.

Two further rules point the same way. **AD-17** allows Node to reach the Python agent service through
`/chat/v*` **only**, and that request carries *"a question and nothing else"* — headers are not a
question, and a `/suggest/v1` endpoint is precisely the *"ad-hoc endpoints accumulating between the
two runtimes"* that AD-17 and AD-15 both exist to prevent. And epics.md names the consequence: the
agent service holds `/tools/v1/catalog/execute` access, so *"an instruction smuggled into a header is
aimed at a runtime that can call tools."*

### It is the extraction side, and the reason is that nothing new is exposed

`deploy-units.json` declares two sides: `extraction` holds `GEMINI_API_KEY`, `reasoning` holds
`REASONING_API_KEY`. The suggester uses the **extraction** credential.

The argument is not "extraction is closer". It is this: **the extraction model already reads these
exact headers.** When the treasurer later uploads the real document, `extractor-gemini.ts` sends the
whole thing — header row included — to that credential. Asking the same side to match the same
strings grants it nothing it does not already receive in the ordinary course of ingestion. Sending
them to *reasoning* would create an exposure that does not exist today, which is what AD-10 is for.

### "No data credential" is a claim about the module, not the process

Worth stating plainly because it is easy to overclaim. The `web` unit holds
`WATCHDOG_WRITER_DATABASE_URL`, `WATCHDOG_READER_DATABASE_URL`, the R2 keys **and**
`GEMINI_API_KEY` — extraction runs inside the Node gateway. So the epic's *"no tool access and no
data credential"* cannot mean process isolation here; there is none to have.

What it means, and what is enforceable, is **what this module can reach**: an allow-listed import
set, the shape story 5.6 already proved with `suggest.test.ts` and `sole-data-path.test.ts` already
proves for the executor. A test that claimed process isolation would be claiming something this
topology does not provide.

## AD-8, and the part that needs care

> **AD-8:** *"Extracted strings are **never string-interpolated into any prompt**: prompts carry row
> identifiers, tools resolve values."*

AD-8's usual mechanism is unavailable here — there is no row identifier for "the word at the top of
column 3", and matching a header requires the model to see the header. The rule is honoured
**literally and structurally** instead:

- The instruction is a **frozen constant**. Headers are never concatenated into it, never templated
  into it, never formatted into it.
- Headers travel as **structured data in a separate request field**, as a JSON array of
  `{position, text}`, so the transport itself distinguishes instruction from data.
- The output is **schema-validated** before anything reads it (AD-9's `responseMimeType` plus
  `responseSchema`, already the extractor's pattern), and a reply that fails validation is a refusal,
  not a partial result.
- The model may only return **a position and a target**. It cannot return free text that reaches a
  screen, a store, or another prompt.

The last point is the one that makes the rest safe: whatever a malicious header persuades the model
to say, the only thing that can come back is a pairing the treasurer then sees and confirms.

## Acceptance Criteria

1. **The model is asked only about the residue.** Deterministic matching runs first; the model is
   sent only the headings it could not resolve and only the targets still unfilled. A file the
   deterministic matcher fully resolves produces **no model call at all**, asserted by a fake that
   fails the test if it is called.

2. **The wizard works when the model does not.** Timeout, refusal, transport error, malformed reply,
   schema-invalid reply, missing configuration — every one degrades to the deterministic suggestion
   already computed. Never an error screen, never a blank mapping surface, never a thrown exception
   reaching the surface. FR-10 requires this and story 5.6 built the seam for it.

3. **Headers are never interpolated into the prompt.** The instruction is a frozen constant; headers
   travel as structured data in their own field. Asserted structurally — a test reads the module and
   fails if the instruction is built with a template literal or concatenation.

4. **The reply is schema-validated, and an invalid one is a refusal.** A reply naming a position that
   was not offered, a target the kind does not publish, a non-integer position, a duplicate claim, or
   any shape the schema does not permit yields *no suggestion from the model*, not a partial one.

5. **The suggestion path reaches no store, no catalog, no chat client and no reasoning credential.**
   Asserted by reading the module's imports against an allow-list, and by a test that fails if
   `REASONING_API_KEY` appears anywhere in the path. `module-reads-both` in AD-10's boundary guard
   must stay clean.

6. **Headers are not logged or retained.** Not in a log line, not in an error message, not in a
   thrown exception's text, and not in any module-level state. A configuration or transport error
   names the *variable* or the status, never the data — the pattern `AgentNotConfiguredError` already
   sets.

7. **Input is bounded before it leaves the process.** The caps story 5.6 published at the port are
   the caps that apply, plus a bound on the request body and a timeout on the call. No new magic
   numbers: a cap that already exists is imported, not restated.

8. **Every suggestion the model contributes is one `assign` accepts**, exactly as the deterministic
   suggester's are — and the treasurer cannot tell from the surface which half produced a suggestion,
   because AC3 of story 5.6 already governs both: offered, not applied.

## Tasks / Subtasks

- [ ] **Task 1 — The residue: what is left after deterministic matching.** A pure function taking
      headings and a kind and returning the unmatched headings and the still-unfilled targets. Pure,
      in `core/mapping/`, no model anywhere near it. (AC1)
- [ ] **Task 2 — The model suggester adapter.** `adapters/extraction/suggester-gemini.ts` implementing
      `ColumnSuggester`: frozen instruction, headers as data, schema-validated reply, bounded and
      timed out, nothing retained. (AC3, AC4, AC6, AC7)
- [ ] **Task 3 — Falling back is the normal case, not the error case.** A composed suggester that
      runs the deterministic one, asks the model only about the residue, and returns the
      deterministic answer unchanged whenever the model does not produce a valid one. (AC1, AC2, AC8)
- [ ] **Task 4 — The structural boundary, asserted.** The import allow-list, the no-reasoning-
      credential check, the no-interpolation check, and AD-10's boundary guard still clean. (AC5)
- [ ] **Task 5 — Wire it, behind configuration.** `mapping-wizard.tsx` names the composed suggester;
      with the model unconfigured the wizard behaves exactly as it does today. (AC2)

## Dev Notes

### What exists — read these before writing anything

| File | Why it matters |
| --- | --- |
| `core/mapping/suggest.ts` | The port, the caps, `deterministicSuggester`. **Do not widen it.** |
| `core/mapping/suggest.test.ts` | The import allow-list shape this story's Task 4 copies |
| `adapters/extraction/extractor-gemini.ts` | The precedent: **no SDK**, plain `fetch`, `responseMimeType`/`responseSchema` as body fields, `MAX_REPLY_BYTES`, `raceAbort`, config read once with a named error |
| `adapters/agent/chat-client.ts` | `AgentNotConfiguredError` — *"Names only, never values"* |
| `core/security/dual-llm-boundary.ts` | `module-reads-both` is a violation kind |
| `deploy-units.json` | Tracked config, not documentation. Changing it changes what the suite permits |
| `core/ports/module-specifiers.ts` | The one import scanner. Task 4 uses `specifiersIn`, never a fifth copy |

### Where the file goes, and the configuration it reads

**`adapters/extraction/suggester-gemini.ts`**, not a new `adapters/mapping/`. The directory already
holds `extractor-gemini.ts` (the extraction credential) and `workbook-sheetjs.ts` (no credential at
all), so it groups *extraction-side adapters* rather than one model. Putting the suggester beside the
credential it shares keeps AD-10's boundary guard reasoning about one place, and a new top-level
adapter directory whose side is ambiguous is how `module-reads-both` becomes hard to argue about.

**Configuration, and one trap.** `extractor-gemini.ts` reads `GEMINI_API_KEY` **and**
`GEMINI_OCR_MODEL`, validated once through `REQUIRED_VARS` with a named error. This story needs a
model id too, and **`GEMINI_OCR_MODEL` is the OCR model — do not reuse it for a task that is not
OCR.** AD-11 binds the model by capability, not by name, so the id belongs in configuration.

If a new variable is added: update `.env.example` (the not-configured error tells the treasurer to
copy it), and **do not add it to `deploy-units.json`'s `credentials` array**. That file's own comment
records why — `GEMINI_OCR_MODEL` was removed from it on 2026-08-11 because *"it is a model
identifier, not a secret… a configuration value listed here weakens what the array means"*. The
boundary guard reads that array as the set of secrets a unit holds.

**Missing configuration is not an error path, it is the ordinary path.** AC2: unconfigured means the
wizard behaves exactly as it does today. The adapter must be constructible-but-inert or simply not
constructed, and either way `column-pairing.tsx` never learns the difference.

### Tests that must still pass, and are the point

These are the architecture's own guards. If a change here makes one of them fail, that is the finding
— not a test to adjust:

- `core/security/dual-llm-boundary.test.ts` — AD-10, including `module-reads-both`
- `core/tools/sole-data-path.test.ts` — the executor is reached from one door
- `adapters/agent/sole-chat-path.test.ts` — exactly one file knows the agent's address
- `core/ports/boundary.test.ts` — `core/` imports nothing outward
- `core/security/no-model-in-alerts.test.ts` — no model in the alerting path
- `core/security/nfr2-guard.test.ts` — NFR-2/AD-2
- Story 5.6's suites: `core/mapping/*.test.ts`, `app/onboarding/mapping/suggestion-surface.test.tsx`

**Baseline to beat:** 3712 passing, lint clean, build clean, `tsc --noEmit` at **1** pre-existing
error. Faking the model: `adapters/extraction/extractor-gemini.test.ts` is the precedent — it fakes
`fetch` rather than reaching the network, and no test in this story may make a real call.

### The seam, and how to tell it is drawn wrong

A `ColumnSuggester` takes headings and a kind and returns suggestions. **That is the whole
interface**, and story 5.6 asserted it structurally. If the model adapter needs an association id, a
store, a document id or a user, the seam is wrong — and `suggest.test.ts`'s import scan is what will
say so.

The composed suggester is also a `ColumnSuggester`. That is what keeps `column-pairing.tsx` unchanged
and keeps AC2 cheap: falling back is returning the value it already has.

### What this story does not do

- **It does not re-import anything.** epics.md flags that a mapping change makes old bytes mean
  something new and AD-13 does not cover it — that is story 5.7's question, not this one.
- **It does not store a mapping.** Also 5.7.
- **It does not put a model in the alerting path.** `core/security/no-model-in-alerts.test.ts` is
  about FR-6/7/8 and stays true. Story 5.6's `heading-match.ts` doc comment already says where that
  line is; do not weaken that comment.
- **It does not change AD-10, AD-15 or AD-17.** If the implementation seems to need to, stop and ask.

### The traps this project keeps setting

- **A guard that proves nothing.** Ten found so far. AC1's "no model call at all" must use a fake
  that *fails* when called, not one that merely records. AC5's import scan must assert it read a
  non-empty list first.
- **Scanning prose for code.** Three occurrences in story 5.6 alone. Every structural check here
  reads `neutralise(...).commentsBlanked`, never the raw file — this story's module will have doc
  comments discussing prompts and credentials, which is exactly what trips a raw scan.
- **A bare `toThrow()`.** Assert the error type.
- **A fixture where two different numbers coincide.** Story 5.6 shipped two.
- **Mutations must be proven to apply.** CRLF on disk; a `\n` anchor silently matches nothing.

### References

- `_bmad-output/planning-artifacts/epics.md` — *"The suggestion is the epic's one real architectural
  risk"*, and *"Try the boring version first"*
- ARCHITECTURE-SPINE.md — **AD-8** (extracted values are data), **AD-9** (schema at the API layer),
  **AD-10** (dual-LLM boundary), **AD-15**/**AD-17** (the two wires), **AD-11** (model bound by
  capability, not name)
- `_bmad-output/implementation-artifacts/5-6-a-guess-offered-not-applied.md` — the port, its bounds,
  and the two scanner action items still open

## Dev Agent Record

### Test Design

### Review Findings

### Completion Notes List

### File List

## Change Log
