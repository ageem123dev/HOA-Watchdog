---
baseline_commit: b873e6f
merge_request: 41
---

# Story 3.4: The model picks an entry

Status: done

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

**AC4 — The model must call a tool.** *(Amended during implementation — see below.)*
A model that answers a catalog question with free text instead of a tool call does not produce an
answer. A test asserts the mechanism that makes this true, not the model's behaviour.

> **Amended 2026-08-10, against the installed package.** As written this AC assumed Gemini's
> `tool_config.function_calling_config.mode = ANY` would be reachable through CrewAI. **It is not.**
> `crewai==1.15.8`'s native Gemini provider assembles `GenerateContentConfig` from a fixed list of
> fields — `temperature`, `top_p`, `top_k`, `max_output_tokens`, `stop_sequences`,
> `system_instruction`, `tools` — with no `tool_config` and no `additional_params` passthrough.
>
> So the guarantee is enforced in `routing.route_question` instead: a chooser that returns no tool
> call raises `ModelChoseNothing`, and it is never an empty result set. **That is the stronger of
> the two.** `mode = ANY` is a request to the model; this is a property of the code, and it still
> holds on the documented ANY-mode failures where Gemini rejects the whole request with
> `INVALID_ARGUMENT` once the combined tool declarations pass an undocumented size budget.
>
> What is genuinely lost: nothing stops the *API* returning prose, so a wasted model call is
> possible where `mode = ANY` would have prevented one. That is a cost in tokens, not in
> correctness.

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

- [x] **Task 1 — An entry can describe itself (AC1, AC2)**
  - [x] Add a `description` field to `CatalogEntry` — one sentence, in the words a model reads.
        `ParameterDeclaration.description` already exists and says why: "Story 3.4 hands these
        schemas to the reasoning model as tool definitions".
  - [x] Write `dues_status@1`'s description.
  - [x] Confirm the AD-14 digest does **not** move. `digest.ts` builds an explicit contract object
        and descriptions are deliberately outside it; add the assertion to
        `published-versions.test.ts` rather than assuming, so a future digest change that swallows
        descriptions fails here.
  - [x] A function that projects a `CatalogEntry` to its agent-facing shape — id, version,
        description, parameters — and **cannot** carry `sql` or `bind`. Type it so an entry field
        added later is not forwarded by default.

- [x] **Task 2 — The describe endpoint (AC1, AC2)**
  - [x] `GET /tools/v1/catalog` returning the projection from Task 1 for every registered entry.
  - [x] Same bearer-token check as `execute`, same error envelope. Reuse
        `core/tools/service-token.ts`'s `verifyServiceToken(presented, configured)` — verified
        present and exported; do not write a second comparison.
  - [x] Test: the response body, serialized, contains no substring of any entry's SQL.
  - [x] Test: an unauthenticated caller is refused, and a blank/absent configured token fails closed
        exactly as `execute` does.
  - [x] `proxy.ts`'s matcher excludes `tools/v\d+/` (verified at story-creation time, line 65),
        so a `v1` path needs no matcher change. Confirm it is still true rather than assuming.

- [x] **Task 3 — The agent fetches and declares (AC1, AC3)**
  - [x] Python: fetch the catalog through the same transport seam `tools_client.py` uses.
  - [x] Build tool declarations from what came back. Every declaration carries the entry's parameter
        schema verbatim, including `additionalProperties: false` and `required`.
  - [x] Test against the **real** catalog shape, not a hand-written fixture: a fixture is a second
        statement of the schema and would pass while the endpoint drifted.
  - [x] Test: no declaration admits a field the entry does not declare.

- [x] **Task 4 — The model chooses (AC4, AC5)**
  - [x] Wire CrewAI `1.15.8` with `gemini-3.6-flash`, forced tool use (Gemini's
        `function_calling_config.mode = ANY`). **The dependency is `crewai[google-genai]==1.15.8`,
        not bare `crewai`** — verified: the bare install has no litellm and the Gemini provider
        raises `ImportError` on construction.
  - [x] The model call is a parameter with a default, exactly as `Transport` is — so every test
        substitutes it.
  - [x] Route: question in → `(entry_id, version, parameters)` → `execute_catalog_entry` → rows +
        provenance id.
  - [x] Test: a stub model that names `dues_status`/1 with valid parameters produces one call to the
        client with exactly those values.

- [x] **Task 5 — Wrong choices fail loudly (AC6)**
  - [x] Unknown entry id → raises. Not a retry loop, not an empty list.
  - [x] Parameters the schema rejects → the gateway's `invalid_parameters` surfaces as
        `InvalidRequest`, which `tools_client.py` already raises. Prove the agent does not catch it.
  - [x] Test: a model that returns no tool call at all is an error, not an empty answer.

- [x] **Task 6 — The credential, and the trap (AC7, AC8)**
  - [x] Read `REASONING_API_KEY`; pass it explicitly to the model client.
  - [x] Update `test_no_data_credentials.py`'s exhaustive read set. **Add `GEMINI_API_KEY` to that
        file's forbidden names** so reading it is a failure with a message, not merely an
        unrecognised name.
  - [x] Add the new declared dependencies to `APPROVED_DEPENDENCIES` — deliberately, one by one, with
        the reason. That list is an allowlist so this is a decision, which is the design.
  - [x] `.env.example`: add `REASONING_API_KEY` and `REASONING_MODEL` with the vendor-boundary note.
        **`docs/readme.test.ts` will go red on both counts if you stop here**: it asserts that every
        variable `.env.example` declares also appears in `README.md`, *and* that the README's stated
        count of variables is correct. Two new variables means two README edits, one of which is a
        number.
  - [x] `agent/README.md`: the configuration table is now four variables, and "What is not here yet"
        is no longer true.

- [x] **Task 7 — The gate (all)**
  - [x] `npm run test:py` covers `agent/`. `npm run test:db` covers `app/tools/` — Task 2 lands
        there, so it applies.
  - [x] Update `deploy-units.json` if the agent unit's credential set changes.

## Dev Notes

### The credential trap, and it is one line wide

**Corrected 2026-08-10, against the installed package rather than the documentation.** The public
integration guidance says CrewAI routes through LiteLLM, which reads `GEMINI_API_KEY` from the
environment. That is not what 1.15.8 does: `pip install crewai==1.15.8` pulls **no litellm at all**,
and `LLM(model="gemini/…")` raises `ImportError: Google Gen AI native provider not available, to
install: uv add "crewai[google-genai]"`. The path is CrewAI's **native google-genai provider**
(`provider='gemini'`, `is_litellm=False`).

**The trap survives the correction, and it is worse than described.** Constructed without an explicit
`api_key`, the native provider reads the environment and **prefers `GOOGLE_API_KEY` over
`GEMINI_API_KEY`**, announcing it on stdout:

```
Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.
api_key after construction with NO explicit key: 'also-not-ours'
api_key when passed explicitly: 'ours'
```

`GEMINI_API_KEY` is the *extraction* credential, held by the `web` deploy unit.

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

Claude Opus 5 (1M context), via `bmad-dev-tdd` inside `bmad-ship-story`.

### Test Design

Failure modes, by behaviour, classified GUARD / PROPAGATE / OUT-OF-SCOPE.

**The catalog projection (`agent-view.ts`)** — GUARD: a field added to `CatalogEntry` later reaching
the model by default; an entry with no description. OUT-OF-SCOPE: parameter *type* checking, which
`validate-parameters.ts` owns.

**The describe endpoint** — GUARD: an unauthenticated caller; a blank configured token; SQL in the
body; the catalog described *in the 401*. PROPAGATE: nothing — this route has no failure the caller
should distinguish.

**The catalog client** — GUARD: a refusal becoming an empty catalog; an entry missing a field; a
schema without `additionalProperties: false`; two versions of one id. PROPAGATE: `GatewayError`
subclasses, unchanged from story 3.3.

**Routing** — GUARD: a model that chose nothing; an entry the catalog does not hold; an undeclared
or missing parameter; a model choosing the version. OUT-OF-SCOPE: answer rendering (3.6) and the
numeric validator (3.5).

**The model client** — GUARD: an absent, blank, or environment-discovered credential; a blank model
id. OUT-OF-SCOPE: whether Gemini honours the prompt, which no local test can assert.

### Debug Log References

**Three findings that came from reading output rather than results.**

1. **A vacuous test I had just written.** `agent-view.test.ts` asserted no entry's SQL appears in the
   serialized view by comparing against `entry.sql` directly. The SQL is a multi-line template
   literal and `JSON.stringify` escapes its newlines, so the raw form is never a substring *whether
   the SQL is present or not*. It passed while the projection leaked `sql`; only the keyword sweep
   fired. Now compared against the escaped form — breaking `agentViewOf` fails 5 assertions, not 4.

2. **A 12x pytest slowdown, from 0.21s to 3.98s.** Installing CrewAI put ~30,000 files under
   `agent/.venv`, and `committed_config_files()` was `rglob("*")` over `agent/` with a `.venv in
   path.parts` filter applied to each *result* — correct, and it enumerated the whole virtualenv
   before discarding it. Two AD-3 tests were 3.6s of the 4.0s. `os.walk` with in-place pruning:
   **3.98s → 0.34s**.

3. **A 16s suite, measured before it was accepted.** `test_model.py` constructs real CrewAI objects:
   ~5.5s to import `crewai`, ~1.3s per `LLM`. Local work, no socket — checked, because story 3.3
   shipped a test that passed by making a real DNS lookup and took 11 of that suite's 11.25 seconds
   while looking healthy. The file now disables CrewAI telemetry and the OTel exporters, so AC8 is
   enforced rather than hoped for.

**Two gate faults, both pre-existing and both surfaced by this story's diff.**

- `docs/readme.test.ts` asserted `` `**${words[n]}** variables` `` from a list ending at `twelve`.
  The thirteenth variable made it assert `**undefined** variables` — the exact fault its own comment
  warns about, one level up. Extended, and the lookup now fails with a message when it runs off
  the end.
- `dual-llm-boundary.test.ts`'s C6 scan timed out at vitest's 5s default under the loaded full-suite
  run. 192 files, ~770ms isolated. Assertion unchanged; headroom raised, because an intermittently
  red gate is one people re-run rather than read.

**The AD-3 exhaustive guard fired, three stories after it was written.**
`test_the_service_asks_only_for_what_ad3_allows` asserts the read set *exactly*, and adding
`REASONING_API_KEY` broke it — which is what "a new variable is a decision somebody makes rather than
a line that slips through" meant. Recorded there with the reason, plus a separate test naming
`GEMINI_API_KEY` and `GOOGLE_API_KEY` against AD-10, so whoever trips that one reads the right rule.

**A security guard was split, not relaxed.** `sole-data-path.test.ts` asserted exactly one file may
import *either* the executor *or* the registry, and the describe endpoint imports the registry.
Reaching the executor is the ability to run a query; reaching the registry is knowing which entries
exist. `THE_DOOR` remains the only file permitted the former — the assertion carrying AD-15 is
untouched — and the registry's readers are named file by file rather than globbed.

### Completion Notes List

- **AC4 could not be met as written and is amended above**, with what was verified and what it costs.
- **The credential mechanism was not what the documentation says.** `crewai==1.15.8` installs no
  litellm; the native google-genai provider picks a key from the environment when not handed one and
  *prefers* `GOOGLE_API_KEY` over `GEMINI_API_KEY`. Both names are planted in tests that assert the
  client never picks them up.
- **`crewai[google-genai]`, not bare `crewai`.** The bare install raises `ImportError` on
  `LLM(model="gemini/…")`.
- Forced tool use is enforced by `ModelChoseNothing`; the version is read from the catalog, never
  from the model; one declaration per entry *id*, never per version.
- Nothing user-visible ships here. Stories 3.5 (validator) and 3.6 (surface) follow, in that order.

### File List

**New** — `catalog/agent-view.ts`, `catalog/agent-view.test.ts`, `app/tools/v1/catalog/route.ts`,
`app/tools/v1/catalog/route.test.ts`, `core/tools/http.ts`, `agent/watchdog_agent/catalog_client.py`,
`agent/watchdog_agent/routing.py`, `agent/watchdog_agent/model.py`,
`agent/tests/test_catalog_client.py`, `agent/tests/test_routing.py`, `agent/tests/test_model.py`

**Updated** — `catalog/entry.ts`, `catalog/entries/dues-status-v1.ts`,
`catalog/published-versions.test.ts`, `catalog/bind-values.test.ts`, `catalog/registry.test.ts`,
`app/tools/v1/catalog/execute/route.ts`, `core/tools/sole-data-path.test.ts`,
`core/security/dual-llm-boundary.test.ts`, `docs/readme.test.ts`, `agent/pyproject.toml`,
`agent/tests/test_no_data_credentials.py`, `agent/watchdog_agent/tools_client.py`, `agent/README.md`,
`README.md`, `.env.example`, `eslint.config.mjs`

## Review Findings

**Argus, three rounds before the CLI round.**

- *Round 1, high.* `environment_variables_read_by` filtered candidate names through a regex requiring
  an underscore. libpq's variables — `PGPASSWORD`, `PGUSER`, `PGHOST` — have none, and
  `FORBIDDEN_NAME` was widened on MR !39 precisely to catch them, so the guard had been blind to
  exactly those names since that fix landed. Proved by running the detector: the forbidden regex
  matches `PGPASSWORD` and the detector returned an empty set for source reading it.
- *Round 1, medium and low.* A blank `REASONING_MODEL=""` fell through to the default because `""` is
  falsy — the parametrized blank test covered `"   "` and not `""`. A GET carried `data=b""` rather
  than `None`, attaching a `Content-Length: 0` some servers refuse.
- *Round 2, medium.* `test_parameters_the_entry_rejects_surface_rather_than_being_swallowed` omitted a
  required parameter, so the pre-flight check raised and the mocked gateway was never called. It
  asserted the pre-flight check while claiming to assert propagation, and would have passed with the
  propagation deleted.
- *Round 3 (on the CLI fix diff), high.* The schema deep-copy separated the view from the decoded
  payload but left `declarations_for` assigning by reference, so the declaration and the view stayed
  one dict — precisely the pair the copy existed to separate. **The fix did not fix the thing it was
  written for.**

**CodeRabbit CLI — 8 findings, 30 of 30 changed files reviewed.** Ingested against `1fbe206` before
any fix; Argus missed both majors. The major that mattered was a consequence of the `call_gateway`
extraction two commits earlier: sharing it with the catalog request widened `_STATUS_ERRORS`, so a
404 from an undeployed catalog route would have reported "the catalog holds no such entry". Also: a
private symbol imported across modules, `Bearer a b` rejoined into a token, the schema shared by
reference, a misleading test name, and duplicated opener-capture setup.

Two skipped with reasons: caching the LLM per process (a global whose invalidation nothing has
needed, and no caller until 3.6), and bumping CrewAI to 1.15.12 (the spine's Stack table pins
1.15.8 — a spine amendment, not a story's call).

**MR !41 round 1 — 6 findings, one major.**

- *Major, and the only finding in the story that could have produced a wrong financial answer.* The
  entry's description said payments were made "toward" the assessment year; the SQL counts payments
  whose `paid_on` falls *within* it. The entry's own header documents that limitation and the
  sentence the model chooses on contradicted it, so a question about which assessment a payment
  settled would have selected this entry and been answered confidently and wrongly.
- `required` was never validated, and `_checked_parameters` reads it as a set — a bare string would
  make every character report as a missing parameter, and a non-iterable would raise `TypeError`.
- `MalformedCatalog` hardcoded `status=200` while `fetch_catalog` discarded the real one, against
  `call_gateway`'s own docstring warning about exactly that.
- `test_nothing_is_executed_by_calling_a_tool` stated a precondition the fixture never established.
- `route.test.ts` stubbed the token to `''` for "no token configured at all", duplicating the blank
  case and never exercising `verifyServiceToken(..., undefined)`.
- A fenced block with no language.

**MR !41 round 2 — clean.** `No actionable comments were generated` over `1c1a3fa..a5997eb`, and
CodeRabbit resolved all threads.

**A process note.** One `argus_review` returned SUCCESS with neither structured output nor prose. That
is a provider failure, not a clean review, and it was retried rather than recorded as zero findings —
the same false-clean the CodeRabbit loop refuses for a skipped review or an empty stream.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-10 | Story created. Baselined on `b873e6f`, the merge of the AD-3/AD-10 amendments this story is the first to depend on. |
| 2026-08-10 | Implemented test-first across seven tasks. **AC4 amended** — CrewAI 1.15.8's Gemini provider cannot express `mode = ANY`, so forced tool use is enforced in `route_question` instead. Status → review. |
| 2026-08-11 | Three Argus rounds, one CodeRabbit CLI round (8 findings) and two MR rounds (6 then clean). Status → done, meaning ready-to-merge on an unmerged branch. |
