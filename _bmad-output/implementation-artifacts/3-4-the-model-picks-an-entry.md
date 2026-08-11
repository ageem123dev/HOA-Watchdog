---
baseline_commit: b873e6f
---

# Story 3.4: The model picks an entry

Status: ready-for-dev

## Why this story exists

Stories 3.1–3.3 built a catalog, a provenance log, a token-checked endpoint, and a Python runtime
that can call it. **Nothing chooses.** `execute_catalog_entry` takes an `entry_id`, a `version` and a
`parameters` dict, and every caller so far has been a test that already knew all three.

This story puts the model in that seat, and the whole point is *how narrow the seat is*:

> **AD-5** — "The agent selects a named entry from a fixed, version-controlled query catalog and
> supplies typed parameters. Tool definitions are declared with `strict: true` and
> `additionalProperties: false`, so parameter validation is guaranteed at the API layer rather than
> requested by prompt. **Free-form SQL from a model is never executed.** A new question shape is a new
> catalog entry — a story, not a runtime capability."

The epic's one-line claim for this story is `Intent routing with strict tool use; no model-authored
SQL is possible`. The second half is the load-bearing half, and it is a claim about *structure*: not
"the model is instructed not to write SQL" but "there is no parameter through which SQL could
arrive".

### The two decisions this story is the first to depend on

Both were made on 2026-08-10, in the commit this story is baselined on:

- **The reasoning model is `gemini-3.6-flash`** (was `claude-sonnet-5`). AD-11 binds by capability,
  not by name, so this is a seed change — but it is the first story that actually calls a model, so
  it is the first that can be wrong about it.
- **AD-10's vendor clause is withdrawn.** Extraction and reasoning are both Google now, so
  *credential separation is the entire boundary*. That turns a naming detail into a security
  property, and §"The credential trap" below is the specific way this story can destroy it in one
  line.

### What this story is not

- **Not a user-visible surface.** No page, no route a board member reaches. Story 3.6 (`Ask and
  answer`) builds that, and 3.7 gives it honest failure states.
- **Not the numeric validator.** AD-7's pre-render check is story 3.5, and the epic is explicit that
  it must exist *before* the first answer renders. Nothing here renders an answer.
- **Not answer prose.** The output of this story is a chosen entry, its bound parameters, the rows,
  and the provenance id. Turning rows into a sentence is 3.6's, behind 3.5's validator.
- **Not a second catalog entry.** `dues_status@1` is the only entry, and one entry is enough to prove
  routing works. A second entry that exists only to make the choice look harder is scope with no
  acceptance criterion.

## Story

**As** the Oracle,
**I want** to choose the right catalog entry and its typed parameters from a board member's question,
**So that** a question can be answered from reviewed SQL that I could not have written.

## Acceptance Criteria

**AC1 — The catalog reaches the agent without being restated.**
The agent obtains the set of callable entries — id, version, human-readable description, and
parameter schema — from the gateway at runtime, over a versioned `/tools/*` endpoint. No entry id,
parameter name, or schema is written a second time in Python.

**AC2 — The model never sees SQL.**
The tool declarations handed to the model, and the payload of the endpoint in AC1, contain no SQL
text. A test asserts this against the real catalog rather than a fixture.

**AC3 — There is no parameter through which SQL could arrive.**
Every tool declaration the agent builds carries `additionalProperties: false` and a `required` list,
and declares only the parameters its catalog entry declares. A test asserts that the declarations
generated from the real catalog admit no free-form field the executor would forward.

**AC4 — The model must call a tool.**
The model is configured for forced tool use — it cannot answer a catalog question with free text
instead of a call. A test asserts the configuration that makes this true, not the model's behaviour.

**AC5 — A chosen entry is executed through the existing client.**
Given a question, the agent produces `(entry_id, version, parameters)` and executes it via
`execute_catalog_entry`, returning the rows and the provenance id. No new path to the gateway.

**AC6 — A choice the catalog does not accept fails loudly.**
If the model names an entry that is not in the catalog, or supplies parameters the entry's schema
rejects, the agent raises rather than guessing, retrying silently, or returning an empty result set.
The gateway's own validation (story 3.1's `validate-parameters.ts`) is the backstop, and a test
proves the agent surfaces its refusal rather than swallowing it.

**AC7 — The reasoning credential is `REASONING_API_KEY` and nothing else.**
The agent service reads its model key from `REASONING_API_KEY`. It does **not** read
`GEMINI_API_KEY`, `GOOGLE_API_KEY`, or any other name — including indirectly, by letting the model
library pick a key up from the environment. `test_no_data_credentials.py`'s exhaustive read-set
assertion is updated to the new set and is the enforcement.

**AC8 — The suite still opens no socket.**
No test in `agent/tests/` makes a network call — not to the gateway and not to a model. The model
call is injectable the way the transport is.

## Tasks / Subtasks

- [ ] **Task 1 — An entry can describe itself (AC1, AC2)**
  - [ ] Add a `description` field to `CatalogEntry` — one sentence, in the words a model reads.
        `ParameterDeclaration.description` already exists and says why: "Story 3.4 hands these
        schemas to the reasoning model as tool definitions".
  - [ ] Write `dues_status@1`'s description.
  - [ ] Confirm the AD-14 digest does **not** move. `digest.ts` builds an explicit contract object
        and descriptions are deliberately outside it; add the assertion to
        `published-versions.test.ts` rather than assuming, so a future digest change that swallows
        descriptions fails here.
  - [ ] A function that projects a `CatalogEntry` to its agent-facing shape — id, version,
        description, parameters — and **cannot** carry `sql` or `bind`. Type it so an entry field
        added later is not forwarded by default.

- [ ] **Task 2 — The describe endpoint (AC1, AC2)**
  - [ ] `GET /tools/v1/catalog` returning the projection from Task 1 for every registered entry.
  - [ ] Same bearer-token check as `execute`, same error envelope. Reuse
        `core/tools/service-token.ts`'s `verifyServiceToken(presented, configured)` — verified
        present and exported; do not write a second comparison.
  - [ ] Test: the response body, serialized, contains no substring of any entry's SQL.
  - [ ] Test: an unauthenticated caller is refused, and a blank/absent configured token fails closed
        exactly as `execute` does.
  - [ ] `proxy.ts`'s matcher excludes `tools/v\d+/` (verified at story-creation time, line 65),
        so a `v1` path needs no matcher change. Confirm it is still true rather than assuming.

- [ ] **Task 3 — The agent fetches and declares (AC1, AC3)**
  - [ ] Python: fetch the catalog through the same transport seam `tools_client.py` uses.
  - [ ] Build tool declarations from what came back. Every declaration carries the entry's parameter
        schema verbatim, including `additionalProperties: false` and `required`.
  - [ ] Test against the **real** catalog shape, not a hand-written fixture: a fixture is a second
        statement of the schema and would pass while the endpoint drifted.
  - [ ] Test: no declaration admits a field the entry does not declare.

- [ ] **Task 4 — The model chooses (AC4, AC5)**
  - [ ] Wire CrewAI `1.15.8` with `gemini-3.6-flash`, forced tool use (Gemini's
        `function_calling_config.mode = ANY`).
  - [ ] The model call is a parameter with a default, exactly as `Transport` is — so every test
        substitutes it.
  - [ ] Route: question in → `(entry_id, version, parameters)` → `execute_catalog_entry` → rows +
        provenance id.
  - [ ] Test: a stub model that names `dues_status`/1 with valid parameters produces one call to the
        client with exactly those values.

- [ ] **Task 5 — Wrong choices fail loudly (AC6)**
  - [ ] Unknown entry id → raises. Not a retry loop, not an empty list.
  - [ ] Parameters the schema rejects → the gateway's `invalid_parameters` surfaces as
        `InvalidRequest`, which `tools_client.py` already raises. Prove the agent does not catch it.
  - [ ] Test: a model that returns no tool call at all is an error, not an empty answer.

- [ ] **Task 6 — The credential, and the trap (AC7, AC8)**
  - [ ] Read `REASONING_API_KEY`; pass it explicitly to the model client.
  - [ ] Update `test_no_data_credentials.py`'s exhaustive read set. **Add `GEMINI_API_KEY` to that
        file's forbidden names** so reading it is a failure with a message, not merely an
        unrecognised name.
  - [ ] Add the new declared dependencies to `APPROVED_DEPENDENCIES` — deliberately, one by one, with
        the reason. That list is an allowlist so this is a decision, which is the design.
  - [ ] `.env.example`: add `REASONING_API_KEY` and `REASONING_MODEL` with the vendor-boundary note.
        **`docs/readme.test.ts` will go red on both counts if you stop here**: it asserts that every
        variable `.env.example` declares also appears in `README.md`, *and* that the README's stated
        count of variables is correct. Two new variables means two README edits, one of which is a
        number.
  - [ ] `agent/README.md`: the configuration table is now four variables, and "What is not here yet"
        is no longer true.

- [ ] **Task 7 — The gate (all)**
  - [ ] `npm run test:py` covers `agent/`. `npm run test:db` covers `app/tools/` — Task 2 lands
        there, so it applies.
  - [ ] Update `deploy-units.json` if the agent unit's credential set changes.

## Dev Notes

### The credential trap, and it is one line wide

**CrewAI routes through LiteLLM, and LiteLLM reads `GEMINI_API_KEY` and `GOOGLE_API_KEY` from the
environment by default.** The common recipe on every integration page is `export
GEMINI_API_KEY=…` — and `GEMINI_API_KEY` is the *extraction* credential, held by the `web` deploy
unit.

Following that recipe would put both sides of the dual-LLM boundary on one credential name. Since
AD-10's vendor clause was withdrawn on 2026-08-10, credential separation is *all* that is left of
that boundary — `deploy-units.json` declares `REASONING_API_KEY` for the reasoning side precisely so
`shared-credential` has something to hold.

So: read `REASONING_API_KEY` and pass it **explicitly** to the model constructor. Never set
`GEMINI_API_KEY` in the agent's environment, and do not rely on library defaults, because a default
that reads an unset variable fails at runtime while a default that reads a *set* one fails silently
and correctly-looking.

`test_no_data_credentials.py`'s exhaustive read-set assertion is the enforcement — it fails on any
variable not in its set, which is exactly why it was written exhaustively rather than as an absence
check. Note that `core/security/dual-llm-boundary.ts`'s C6 (`no module reads both sides`) scans
`core/`, `adapters/`, `app/` and `scripts/` with a **JavaScript** syntax matcher; it does not and
cannot see Python. The Python test is not a duplicate of it — it is the only guard on that side.

### `strict: true` is not a Gemini concept, and the enforcement is not the model's anyway

The Consistency Conventions say every agent-facing tool declares `strict: true` and
`additionalProperties: false`. `additionalProperties: false` is already a literal type in
`ParameterSchema`, so an entry that relaxes it does not compile. `strict` is OpenAI vocabulary;
Gemini's equivalent is `tool_config.function_calling_config.mode = ANY` (forced call, free-text
replies disabled).

**But the guarantee does not rest on either.** Story 3.1 shipped `validate-parameters.ts`, and the
gateway validates every parameter set server-side before binding — its header states that "an
undeclared property is always rejected", and it names the accepted parameters in the error. A model that emits a stray field or
a string where an integer belongs is refused by the gateway, not trusted because a flag was set. The
model-side configuration is defence in depth; the server-side validator is the enforcement. Test both
and be honest in the story about which is which.

**One known Gemini quirk, recorded because it will look like a bug later.** ANY mode has undocumented
schema budgets — aggregate enum complexity, a sum of `maxItems` across all tool schemas, and roughly
77 KB of combined tool-declaration JSON — past which the API returns `INVALID_ARGUMENT` while AUTO
mode accepts the identical request. With one catalog entry this is nowhere near live. It becomes a
real constraint somewhere north of a few dozen entries, and the symptom is an argument error that
reads like a code bug.

### Why the catalog travels over the wire rather than being restated

The catalog is TypeScript and the agent is Python. The tempting shortcut is a dict of entry ids and
schemas in Python. That is a second statement of a shape with nothing failing on disagreement, which
migration 007's comment records as this project's standing mistake — and the disagreement here is not
cosmetic: a stale parameter name in Python is a request the gateway rejects, and a stale *type* is a
request it accepts and binds wrongly.

AD-15 already says the `/tools/*` endpoints are the sole path between the runtimes, so a describe
endpoint is the existing pattern rather than a new one.

**The projection must not be able to leak SQL.** Write it so that adding a field to `CatalogEntry`
does not silently add it to the wire — an explicit picked shape, not a spread with deletions. AD-5
keeps SQL away from the model; AD-8's reasoning ("prompts carry row identifiers, tools resolve
values") is the same instinct one layer down.

### Learnings that apply directly

From **3.3**, which is the closest relative:

- **The transport is a parameter, and that is why the suite has no network.** Do the same for the
  model call. 3.3's round-3 finding is the cautionary tale: a test patched `urllib.request.urlopen`
  while the code had moved to `opener.open`, so it made a **real DNS lookup**, passed because that
  failed, and took 11 of the suite's 11.25 seconds. **If the suite's runtime jumps, that is the
  signal** — it was visible in every run for two rounds before anyone read it.
- **A guard can pass by checking nothing.** 3.3 shipped two vacuous ones: a source sweep over an
  empty package, and a detector matching call sites while the code read through a module constant.
  The *exhaustive* assertion caught them; the absence assertion did not. Write both.
- **Never let a failure become an empty result.** `test_no_data_credentials.py` and
  `test_tools_client.py` both exist around this: a 401 turned into `[]` is "this unit owes nothing",
  which is a wrong financial answer with a confident face. AC6 is the same rule for a wrong choice.
- **A security test must not print what it finds.** 3.3's credential scanner copied 60 characters of
  the matching line into output the assertion prints. Report a category and a line number.

From **3.1**, on the catalog itself:

- `ParameterDeclaration.description` was written *for this story* and says so. Read `catalog/entry.ts`
  before adding anything to it.
- Descriptions are deliberately outside the AD-14 digest. Task 1 pins that rather than trusting it.

### Testing standards

Vitest for the Node side, pytest (3.13, from `agent/.venv`) for Python. Test-first per
`bmad-dev-tdd`: a failing test that fails for the right reason before the code exists.

The gate for this story is `npm run lint`, `npm run build`, `npm test`, **`npm run test:db`** (Task 2
touches `app/tools/`), **`npm run test:py`** (Task 3–6 touch `agent/`), and `npx --no-install tsc
--noEmit` against its baseline of 8 pre-existing errors. There is no CI; this list is the whole of
the evidence.

### If this has to be cut

Cut **Task 4's CrewAI wiring** last and everything else first — it is the only part that needs a
network at runtime, and the routing seam can be proven with a stub model. A story that ends with the
declarations built, the endpoint shipped, the credential separated, and a stub model driving the
route still proves `no model-authored SQL is possible`, which is the epic's claim. What must **not**
be cut is AC7: shipping a model call that picks up `GEMINI_API_KEY` from the environment silently
collapses the only remaining half of AD-10.

### References

- [Source: ARCHITECTURE-SPINE.md#AD-5] — the model never authors SQL; a new question shape is a story
- [Source: ARCHITECTURE-SPINE.md#AD-11] — capability bar: strict tool use and schema-validated
  structured outputs; the model id is seed
- [Source: ARCHITECTURE-SPINE.md#AD-10, amended 2026-08-10] — credential and deploy-unit boundary;
  the vendor clause is withdrawn
- [Source: ARCHITECTURE-SPINE.md#AD-15] — versioned `/tools/*` endpoints are the sole data path
- [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions] — every agent-facing tool declares
  `strict: true` and `additionalProperties: false`
- [Source: ARCHITECTURE-SPINE.md#Stack] — CrewAI `1.15.8`, reasoning model `gemini-3.6-flash`,
  Python 3.13
- [Source: epics.md#Epic-3] — story spine; 3.4 proves "Intent routing with strict tool use; no
  model-authored SQL is possible"
- [Source: docs/prd/prd.md#NFR-4] — capability bar, current binding `gemini-3.6-flash`
- [Source: catalog/entry.ts] — `ParameterDeclaration.description` is written for this story
- [Source: catalog/digest.ts] — descriptions are outside the AD-14 digest, deliberately
- [Source: agent/watchdog_agent/tools_client.py] — `execute_catalog_entry`, and the transport seam
- [Source: 3-3-the-python-service-exists.md] — the vacuous-guard and no-network learnings

## Dev Agent Record

### Agent Model Used

_To be filled by the dev agent._

### Test Design

_To be filled by the dev agent._

### Debug Log References

_To be filled by the dev agent._

### Completion Notes List

_To be filled by the dev agent._

### File List

_To be filled by the dev agent._

## Review Findings

_To be filled by the review._

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-10 | Story created. Baselined on `b873e6f`, the merge of the AD-3/AD-10 amendments this story is the first to depend on. |
