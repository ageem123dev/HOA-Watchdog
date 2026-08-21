---
Status: review
baseline_commit: 17b6794bbea06cea3a7c55a1504c9061cb615cc7
merge_request:
---

# Story 5.1c: The actor is proved, not relayed

## Story

As **a board member**,
I want **the system to be able to prove which member a question was asked for**,
so that **holding a service token is not the same as being able to ask on anyone's behalf**.

Split from story 5.1b on 2026-08-21, and widened on the same day when MR !71 merged.

**The actor is claimed, not proved.** 5.1b made the association a derived value the caller cannot
choose — but it derives it **from `actorId`**, and `actorId` is a plain field in the body of
`/tools/v1/catalog/execute`. The trust anchor moved rather than disappeared.

**Narrowed again on 2026-08-21**, after task 2 landed and the remaining scale became concrete. The
scoping-guard half — the same mistake in a second place — is **story 5.1d**. They share a theme and
no files, so combining them bought nothing and cost reviewability.

## What is *not* wrong, stated first

A review of 5.1b read this as "an injected agent can pass another board member's id". **It cannot**,
and starting from the wrong threat would produce the wrong design:

- `route_question(question, *, actor_id, ...)` takes the actor as a Python keyword argument threaded
  from the chat request. The model returns only `choice.name` and `choice.arguments`.
- `choice.arguments` is validated against the entry's own parameter schema
  (`additionalProperties: false`), and no entry declares an actor parameter.
- Nothing in the tool declarations handed to the model mentions an actor.
- `/chat` is token-authenticated, with a *different* token from the gateway's (AD-17).

`core/security/actor-is-never-chosen.test.ts` pins all of that, and both halves were proved by
mutation. **This story is not about the model.**

## What is actually wrong

**Anything holding a service token can name any board member.** The gateway believes `actorId`
because it arrived on an authenticated connection, not because anything proves the person behind it
consented.

Two things follow. Neither is urgent today; both get worse on the day a second association exists.

1. A leaked or misused `AGENT_SERVICE_TOKEN` reads any association's records, not just the pilot's.
   The token already grants full catalog read, so the *marginal* gain is choosing whose — which is
   exactly what story 5.1b spent itself constraining everywhere else.
2. The audit trail records `actorId` as fact. `query_log` says a named director asked a question.
   Nothing distinguishes "they did" from "something with the token said they did", and AD-12's
   record is what a board would be shown.

## Acceptance Criteria

1. **A tool request carries proof of its actor, not a claim about one.** The Next.js side mints a
   short-lived signed token binding `actorId` (and the association resolved for them); the agent
   service relays it **opaquely**, never constructing or modifying it; the gateway verifies it before
   the provenance write.

2. **A forged or altered actor claim is refused, and a test proves each.** Wrong signature, expired,
   `actorId` altered after signing, and a token minted for a different audience.

3. **The agent service cannot mint one.** It holds no signing key. A structural test asserts this,
   in the shape `core/security/no-model-in-alerts.test.ts` uses — the property is what makes the
   relay honest rather than a second place that can assert an identity.

4. **`actorId` stops being a request field it is possible to believe.** Either the gateway derives
   it from the verified token and ignores a body value, or it refuses a request that carries one —
   and a test proves which, in the shape 5.1b's `associationId` refusal already uses.

5. **The expiry window is stated and tested.** A relayed token outliving the turn it was minted for
   is a bearer credential for that member; the window is short enough that replay is bounded, and
   long enough that a slow model call does not fail a legitimate turn.

6. **AD-15 and AD-17 are amended before the code lands**, not after. Both describe a two-token
   arrangement between gateway and agent service; this adds a third credential with different
   properties — per-turn, per-actor, signed by one side and verified by the other.

## Tasks / Subtasks

- [x] **Task 1 — The amendment.** Written 2026-08-21 as **AD-18**, with amendments on AD-15 and
      AD-17 pointing to it. A new AD rather than widening either, following AD-17's own precedent:
      both existing tokens authenticate *runtimes*, and neither carries a subject, so widening one
      to cover a per-turn per-actor credential would blur the claim its own test enforces. (AC6)
- [x] **Task 2 — Mint and verify.** The signing on the Next.js side, the verification at the
      gateway, and the key's home. (AC1)
- [x] **Task 3 — The refusals.** Forged, expired, altered, wrong audience. (AC2, AC5) Task 2 had
      already driven all four through the gateway in `route.test.ts`, each asserting a valid
      assertion is still accepted in the same run. What was **missing** was AC5's other half: every
      expiry test moved the clock *relative to* `ACTOR_ASSERTION_TTL_MS`, so all of them passed at
      any value it held — a week included. Closed with a bounds test tying the window to the
      gateway's own `DEFAULT_TIMEOUT_MS` below and fifteen minutes above.
- [x] **Task 4 — The relay is a relay.** The agent service passes the token through and holds no
      key; the structural test that says so. (AC3)
- [x] **Task 5 — Retire the believable `actorId`.** (AC4) The gateway refuses a request carrying
      the field, mirroring 5.1b's `associationId` refusal — **not** the "derives it and ignores a
      body value" branch AC4 also allows. Reasoning below.

## Dev Notes

### Where this sits relative to 5.1b

5.1b established that the association is derived from the actor and that no caller can supply it.
This story establishes that the *actor* is proved. Until it lands, the honest statement is: the
gateway trusts its callers, and its callers are the code we wrote plus anything holding the token.

### Sequencing, and why this is not urgent

`core/security/no-association-creation.test.ts` forbids the product from creating a second
association. While exactly one exists, choosing an actor changes *which member* a query is attributed
to, not *which records* come back. That is an audit-integrity problem rather than a confidentiality
one — real, and much smaller than the confidentiality version it becomes on the day a second
association is onboarded.

**So the ordering constraint is: this story, or the RLS work AD-4's amendment calls for, must precede
onboarding a second association.** 5.1b's creation guard is what forces that conversation.

### The mistake to avoid

Do not start from "a prompt-injected model could choose an actor". It cannot, that is pinned by a
test, and designing against it produces a control in the wrong place — inside the agent, which is the
component that would have to be trusted to apply it.

### The chain as it stands today

Read in full while preparing this story. Every one is an UPDATE.

`app/oracle/page.tsx` → `app/oracle/ask.ts` → `adapters/agent/chat-client.ts` →
`agent/watchdog_agent/chat_service.py` → `routing.py` → `tools_client.py` →
`app/tools/v1/catalog/execute/route.ts`.

- **`app/oracle/page.tsx:73`** — `const actorId = session.user.id`, and it redirects when there is
  no session. `core/security/actor-is-never-chosen.test.ts` pins both, plus that the call site
  passes the binding by shorthand.
- **`adapters/agent/chat-client.ts`** — sends `{ question, actorId }` with a
  **`GATEWAY_SERVICE_TOKEN`** bearer. Refuses a non-https base URL, bounds the turn at 60s, and
  refuses a malformed 200 rather than passing it to a renderer. Its header comment records AD-17's
  rule that this token is *not* `AGENT_SERVICE_TOKEN`.
- **`agent/watchdog_agent/chat_service.py`** — `PERMITTED_FIELDS = ("question", "actorId")`, and it
  refuses any field outside that set. Token-checked with constant-time comparison; an unset token
  refuses everyone.
- **`agent/watchdog_agent/routing.py`** — `route_question(question, *, actor_id, ...)`. The model
  supplies only `choice.name` and `choice.arguments`; `actor_id` is threaded as a keyword.
- **`agent/watchdog_agent/tools_client.py`** — `execute_catalog_entry(..., actor_id=...)` posts
  `{entryId, version, parameters, actorId}` with the **`AGENT_SERVICE_TOKEN`** bearer.
- **`app/tools/v1/catalog/execute/route.ts`** — verifies the service token *first*, then parses.
  Already refuses a body carrying `associationId` (5.1b, AC2). `readRequest` whitelists four fields.
- **`core/tools/service-token.ts`** — `verifyServiceToken`, constant-time, unset-refuses-everyone,
  length mismatch returns `false` rather than throwing so there is no length oracle. **The
  assertion verifier should follow this file's shape**, including that last property.

### The design decisions this story has to make, made here

**Where the assertion is minted.** In the Node gateway, on the way out — `app/oracle/ask.ts` or
`chat-client.ts`. Not in `page.tsx`: the page already proves it holds a session, and moving crypto
into a React server component puts a signing key somewhere a future page will copy from.

**HMAC, not a JWT library, and no algorithm field.** Node both mints and verifies (AD-18), so there
is no second party to negotiate an algorithm with — and an `alg` field with no negotiation is JWT's
classic confusion vector for nothing gained. A fixed-format `base64url(payload).base64url(hmac)`
using `node:crypto`'s `createHmac` and `timingSafeEqual` is the whole mechanism. **This is not
rolling your own crypto** — the primitive is standard and used as intended; what is avoided is the
parsing surface that carries JWT's actual CVEs. If a reviewer argues for `jose`, that is a
dependency decision for Matt and not a fix.

**The payload is the subject, an expiry, and an audience.** No association: 5.1b derives that from
the subject, and putting it in the token would create a second source that can disagree with the
database — the shape migration 007's comment warns about.

**`actorId` leaves the wire.** AC4 says the gateway must stop believing it. Prefer *refusing* a
request that carries one, matching the `associationId` refusal 5.1b already added two lines above —
one shape, one reason, and a caller that tries is told rather than silently ignored.

**Python's `PERMITTED_FIELDS` is the relay's whole contract.** It becomes
`("question", "actorAssertion")`. That the agent holds no key is then provable by the same
structural shape `core/security/no-model-in-alerts.test.ts` uses: no module on the relay path may
read a signing-key variable.

### The vacuity risk, named in advance

AC2's four refusals are the ones that will look green while proving nothing. A test that asserts
"a forged token is refused" passes if verification refuses *everything* — including valid tokens.
So each refusal case needs a sibling assertion that the **valid** token is accepted in the same
test run, and the expiry case needs an injected clock rather than a sleep. 5.1b shipped exactly this
shape twice and the sensitivity check is what caught it.

### References

- `_bmad-output/implementation-artifacts/5-1b-the-catalog-answers-for-one-association.md` — the
  derivation this rests on, and the corrected note on this threat
- `core/security/actor-is-never-chosen.test.ts` — what is already proved
- `.../ARCHITECTURE-SPINE.md` — AD-12, AD-15, AD-17
- `agent/watchdog_agent/routing.py`, `agent/watchdog_agent/chat_service.py`
- `app/tools/v1/catalog/execute/route.ts`

## Dev Agent Record

### Agent Model Used

### Test Design

#### Task 2 — Mint and verify

**Design decision forced by testability:** the mechanism lives in a pure module,
`core/auth/actor-assertion.ts`, taking the key and the current time as **arguments**. Reading the
key from `process.env` inside would make "unconfigured" untestable, which is the case that matters
most — `core/tools/service-token.ts` sets the house precedent and its header says why.

**Behaviour 2.1 — `mintActorAssertion(subject, { key, now, ttlMs, audience })`.**

*Signal:* a string that `verifyActorAssertion` resolves back to the same subject.
*Seam:* key and clock are parameters. No environment, no `Date.now()`.

| # | Failure mode | Class |
| --- | --- | --- |
| 2.1a | The key is absent or blank, and it mints an *unsigned-but-well-formed* assertion | GUARD — refuse to mint. An unconfigured minter that produces something is worse than one that produces nothing |
| 2.1b | The subject is empty or blank, so a token is minted that names nobody | GUARD — refuse |
| 2.1c | The subject contains the field delimiter and shifts the payload boundary | GUARD — base64url encoding makes the delimiter unrepresentable in a field; a test forces a subject containing `.` and `\|` |
| 2.1d | `ttlMs` is zero or negative, so the token is born expired | GUARD — refuse rather than mint something that can never verify |

**Behaviour 2.2 — `verifyActorAssertion(assertion, { key, now, audience })`.**

*Signal:* the subject, or a refusal naming which check failed — to the caller, never to the wire.

| # | Failure mode | Class |
| --- | --- | --- |
| 2.2a | **It refuses everything, including valid tokens.** The vacuity this story was warned about | GUARD — every refusal case asserts a *valid* token is accepted in the same run |
| 2.2b | The signature is wrong | GUARD |
| 2.2c | The payload is altered after signing — the subject swapped for another member's | GUARD. The one that matters: this is the attack |
| 2.2d | Expired, at the boundary and one millisecond either side | GUARD — injected clock, never a sleep |
| 2.2e | Minted for a different audience | GUARD |
| 2.2f | Malformed: no delimiter, two delimiters, empty half, non-base64 body | GUARD — refuse, never throw |
| 2.2g | A signature of a different length makes `timingSafeEqual` raise `RangeError`, so a wrong-length token throws while a wrong-value token returns false — a length oracle | GUARD — compare lengths first and return a refusal, exactly as `verifyServiceToken` does |
| 2.2h | The key is absent or blank | GUARD — refuse everyone, matching `verifyServiceToken`'s unconfigured-rejects-everybody |

*Inverse (required by `require_inverse_or_crosscheck`):* mint → verify returns the original subject,
for subjects including a UUID, a delimiter-bearing string, and one with multi-byte characters.

*Cross-check:* the signature is recomputed independently in the test with `createHmac` over the same
payload, so the assertion is not merely self-consistent with whatever `mint` produced.

#### Task 4 — the Python relay

Two behaviours, and they fail in different directions. **Threading** breaks loudly (a turn 400s or
the gateway 401s); **holding a key** breaks silently, and the silent one is the reason AC3 exists.

| # | Failure mode | Class |
| --- | --- | --- |
| 4.1a | The relay forwards under the old field name, so the gateway sees no assertion | GUARD — the wire-shape assertion in `test_tools_client.py` names the exact body |
| 4.1b | `chat_service` still permits `actorId`, so a caller can send either and one of them is unchecked | GUARD — `PERMITTED_FIELDS` is an allowlist and its test drives an unknown field |
| 4.1c | The assertion arrives absent, empty or non-string and is relayed anyway | GUARD — refuse at the boundary with `400`, before any model call |
| 4.1d | The relay validates the assertion *itself* and forms a second opinion it has no key to justify | OUT-OF-SCOPE by construction — shape only; validity is the gateway's `401` |
| 4.2a | Somebody adds a signing key to the agent so it can mint "just this once" | GUARD — the capability sweep over `os.environ`/`os.getenv` names |
| 4.2b | The key arrives through a committed config file rather than the environment | GUARD — the same sweep over `agent/**` config suffixes |
| 4.2c | The relay decodes the payload to read the subject, the first step toward trusting it | GUARD — source sweep for `b64decode`, `hmac` and friends |
| 4.2d | The sweeps pass by scanning nothing — a wrong root, a renamed package | GUARD — `test_the_package_has_source_to_scan`, plus a matcher test asserting the pattern fires on a real key name and *not* on the two secrets the agent legitimately holds |

*Deliberately not tested here:* that the assertion the gateway receives verifies. That is the Node
side's property and `route.test.ts` owns it — asserting it from the Python side would need a key
this runtime must not have, which is the thing 4.2a forbids.

#### Tasks 3 and 5 — what was actually left

Both tasks were **partly discharged by task 2's implementation**, and the work here was finding the
part that was not. Recorded that way rather than as fresh work, because "already covered" is the
claim an AC audit exists to disbelieve.

| # | Failure mode | Class |
| --- | --- | --- |
| 3.1a | The expiry tests all move the clock relative to the constant, so the suite is green at any window — including one that makes a relayed assertion a bearer credential for that member | GUARD — bounds asserted against `DEFAULT_TIMEOUT_MS` and fifteen minutes; proved by mutating the constant in **both** directions |
| 3.1b | The lower bound is written as a chosen number and drifts when the gateway timeout is raised | GUARD — the bound *is* the imported timeout, so raising either alone fails |
| 5.1a | `actorId` in the body is silently ignored, so a caller supplying it gets a `200` and believes it worked | GUARD — refused, `400`, executor never called |
| 5.1b | The guard refuses only a *disagreeing* `actorId`, which answers "whose turn is this?" by which value comes back `200` | GUARD — the case list includes the assertion's own subject |
| 5.1c | The guard is written as a truthiness check, so `null`, `''` and `0` pass and a prober learns which shapes the endpoint tolerates | GUARD — `Object.hasOwn`, with those three in the case list |
| 5.1d | The refusal block passes because the endpoint refuses *everything* | GUARD — the inverse case in the same block: the identical request without the field returns `200` and the executor receives the proved subject |
| 5.1e | An unauthenticated caller learns the field exists from a `400` | GUARD — `401` outranks `400`, as it already does for `associationId` |

### Debug Log References

**Task 2.** The first red was a missing-module error, which is not a valid red — the module was
stubbed with correct signatures and deliberately wrong bodies so the 25 cases failed on assertions
instead. Green after the real implementation.

**Sensitivity, both directions.** Removing the `timingSafeEqual` comparison failed *two* cases —
the forged signature and the tampered payload — which is the pair that matters. Relaxing the expiry
from `>=` to `>` failed `refuses exactly at expiry` and nothing else, so the boundary case is
carrying its own weight rather than riding on its neighbours.

**A fabricated SHA, caught before it shipped.** `baseline_commit` was set by padding the short hash
`17b6794` to full length rather than reading `git rev-parse HEAD`. It looked entirely plausible and
was wrong; the review diff range depends on it. Corrected to
`17b6794bbea06cea3a7c55a1504c9061cb615cc7`.

**`it.each` title bug.** Three columns and one `%s` printed the elapsed milliseconds where the
expectation belonged — `at one millisecond before expiry, accepted = 59999`. Labels are
self-describing now, because a red test whose name reads as gibberish is a red test nobody trusts.


### Completion Notes List

**Task 2 — mint and verify.** *(reopened — see below)* `core/auth/actor-assertion.ts`, pure, with
the key and the clock as arguments.

> **Marked complete prematurely and reopened 2026-08-21.** Task 2 is "the signing on the Next.js
> side, the verification at the gateway, and the key's home". Only the mechanism existed:
> `actor-assertion.ts` was imported by nothing but its own test. That is the shape the AC audit has
> caught on nine consecutive stories — built, tested, wired to nothing — and marking it done was the
> "NO LYING OR CHEATING" gate failing. The mechanism's own notes below stand; the wiring follows.

**The wiring, now done.**

- **Minting** — `adapters/agent/chat-client.ts` mints on the way out and sends `actorAssertion`. It
  sends **no `actorId` at all**: leaving the claim beside the proof would keep the believable path
  open and make the assertion decoration. An exact-keys assertion pins the wire to
  `['actorAssertion', 'question']`, so a third field cannot appear unnoticed.
- **Verification** — `/tools/v1/catalog/execute` verifies and hands the executor
  `actorId: verified.subject`. Never a request field.
- **The key's home** — `ACTOR_ASSERTION_KEY`, read at request time, documented in `.env.example`
  with the warning that matters: **the agent service must never hold it**, because a relay that can
  mint is not a relay.
- **The constants live in `core`**, imported by both ends. A copy on each side is two statements of
  one rule with nothing failing on disagreement — they drift, and the symptom is every turn refused
  for `audience` with both sides looking correct in isolation.

**Task 5's AC4 is satisfied here, ahead of its task.** Requiring `actorAssertion` in `readRequest`
means the gateway no longer accepts a believable `actorId` — which is AC4. The alternative was a
transitional accept-both path with its own tests, then deleting them. Recorded rather than claimed
separately when task 5 comes round.

**The db route test got stronger rather than merely updated.** It now proves the provenance row
names the actor the *assertion proved*, not the one the request claimed — the property AD-18 exists
for, asserted end to end against a real database.

- **HMAC-SHA256 with no algorithm field.** Node mints and Node verifies, so there is no second party
  to negotiate an algorithm with, and an `alg` field would carry JWT's classic confusion vector for
  nothing gained. Fixed format, verifier recomputes rather than reads.
- **Signature is checked before the payload is parsed**, so a tampered assertion is reported as a bad
  signature rather than as malformed. Those are different events — one is somebody trying, the other
  is something broken.
- **Length compared before `timingSafeEqual`**, which raises `RangeError` on unequal lengths. Letting
  it escape would answer a wrong-*length* signature with an exception and a wrong-*value* one with a
  refusal — a length oracle. `core/tools/service-token.ts` records the same reasoning; this follows
  it deliberately rather than by coincidence.
- **Unconfigured refuses everybody**, and minting without a key throws rather than producing
  something unsigned. An unconfigured minter that produces *something* is worse than one that
  produces nothing.
- **The payload carries no association.** 5.1b derives it from the subject inside the provenance
  write; a copy here would be a second source that can disagree with the database.
- **Every refusal case asserts a valid assertion is still accepted in the same run.** A verifier that
  refused everything would pass a naive "forged tokens are refused" suite while taking the Oracle
  down. That shape shipped twice on 5.1b.


**Task 4 — the relay**

- **`actorId` became `actorAssertion` end to end.** `PERMITTED_FIELDS` is an allowlist, so the
  rename *removes* the old field rather than adding beside it: a request naming `actorId` is now an
  unknown field and refused, which is the property that makes "the actor is proved" true of every
  request rather than of the well-behaved ones.
- **The agent validates shape and nothing else.** Non-empty string, then relay. It has no key with
  which to form a second opinion, and a check it cannot justify would read like one it could.
- **The capability guard checks what the runtime can reach, not what it imports.** A grep for `hmac`
  proves nothing about capability — `test_no_data_credentials.py` makes the same argument about AD-3
  and this follows it deliberately. So the sweep reads every string passed to `os.environ`/`os.getenv`
  via AST, and every committed config file under `agent/`.
- **The guard is proven by mutation in both directions.** A key added to `routing.py`'s environment
  reads, an `hmac` import on the relay path, and a `.env` carrying the key each turn it red; the
  wire-shape and boundary tests each turn red under their own mutation. All four reverted and
  re-verified green.
- **Four tests exist only so the sweeps cannot pass vacuously**: one asserting there is source to
  scan, and one asserting the matcher fires on a real key name while staying quiet on
  `GATEWAY_SERVICE_TOKEN` and `GEMINI_API_KEY`. A sweep whose pattern is wrong reports success
  forever.
- **`sed -i` silently rewrote three test files from CRLF to LF.** Git normalises on commit so the
  diff was unaffected, but the working tree was left mixed. Normalised back and re-run. Recorded
  because the mutation harness hit the same trap: a `
` anchor found nothing in a CRLF file and the
  revert asserted zero matches.

**Tasks 3 and 5 — the refusals and the retirement**

- **AC5 was stated but not enforced.** The window's *reasoning* lived in a docstring and every test
  around it was relative to the constant, so widening `ACTOR_ASSERTION_TTL_MS` to a week broke
  nothing. This is the vacuity this project keeps finding, in a new shape: not a test that passes
  when the behaviour is deleted, but a suite that passes at every value of the number it is about.
- **The lower bound is the gateway's own timeout, imported, not a number chosen to match it.** A
  turn may take the full `DEFAULT_TIMEOUT_MS`; an assertion that can expire inside a turn the
  gateway is still waiting for fails legitimate requests on the clock, intermittently, under load.
  Raising either constant alone now fails. The upper bound is a judgement, and writing it into a
  test is what makes it reviewable rather than merely asserted.
- **`actorId` is refused, not ignored** — AC4 permits either, and this is the choice. Ignoring is
  safe *today*, because nothing reads the field; but the field would then sit in every request body
  looking exactly like an input, which is a property of the current code rather than of the design.
- **Refused even when it agrees with the assertion's subject.** A guard that refused only a
  disagreeing `actorId` would teach a caller the field works, and would answer "whose turn is this?"
  by which value comes back `200`.
- **The refusal block carries its own inverse.** The same request without the field returns `200`
  and the executor is called with the proved subject — so the five refusals cannot be passing
  because the endpoint refuses everything.
- **Sensitivity:** the five refusals were red before the guard and green after, which is the
  strongest form of the check. The bounds test was mutated both ways — a week and thirty seconds —
  and failed on each, restored green.

### File List

**Task 2**

- `core/auth/actor-assertion.ts` *(new)* — mint, verify, and the shared TTL/audience constants
- `core/auth/actor-assertion.test.ts` *(new)* — 25 cases
- `adapters/agent/chat-client.ts` — mints and sends the assertion; refuses to send unconfigured
- `adapters/agent/chat-client.test.ts`
- `app/tools/v1/catalog/execute/route.ts` — verifies, and passes the proved subject to the executor
- `app/tools/v1/catalog/execute/route.test.ts`
- `app/tools/v1/catalog/execute/route.db.test.ts` — provenance names the proved actor
- `.env.example` — `ACTOR_ASSERTION_KEY`, and why the agent must not hold it
- `README.md` — the variable count and its group
- `docs/readme.test.ts` — the number-word lookup extended

**Task 4**

- `agent/watchdog_agent/chat_service.py` — `PERMITTED_FIELDS`, the boundary check, the router call
- `agent/watchdog_agent/routing.py` — threads the assertion, keyword-only, untouched
- `agent/watchdog_agent/tools_client.py` — the one place it leaves the process
- `agent/tests/test_relay_holds_no_key.py` *(new)* — AC3's structural guard, 5 cases
- `agent/tests/test_chat_service.py`, `agent/tests/test_routing.py`, `agent/tests/test_tools_client.py`

**Tasks 3 and 5**

- `app/tools/v1/catalog/execute/route.ts` — refuses a body `actorId`, with the reasoning in place
- `app/tools/v1/catalog/execute/route.test.ts` — the refusal block, its inverse, and the `401` rank
- `adapters/agent/chat-client.ts` — `DEFAULT_TIMEOUT_MS` exported so the bound can be the real one
- `adapters/agent/chat-client.test.ts` — AC5's bounds test


### Review Findings

#### The AC audit (step 4c) - tenth consecutive story it has found something

AC1 says the gateway verifies the assertion **before the provenance write**. Every refusal case
asserted `execute` was not called, which is the right seam at the unit level - but at the *database*
level the only refusal proved was a **bad service token**, refused by AD-15's check on an earlier
line than AD-18's. A forged assertion had never been shown to leave `query_log` untouched against a
real database. Added, with its inverse in the same run.

The same pass found the accepted-path db test still titled *"naming the actor the request
supplied"* - the pre-AD-18 contract, on a test that no longer checks it - and a stale `AC7`
reference the split from 5.1b carried over.

#### The forgery that proved nothing (found by mutation, during the audit)

Adding the db-level case above, the mutation that should have proved it - deleting the
`timingSafeEqual` comparison - **left the suite green**. The forged signature was
`bm90LXRoZS1zaWduYXR1cmU`, 23 characters, where a real base64url SHA-256 is 43. It was being refused
by the *length* pre-check and never reached the comparison at all.

So the case named "refuses a forged signature" did not prove the signature was checked. **The same
weak forgery was in the unit test**, where it had read as covered since task 2. Both now sign the
payload with the wrong key, which is the right length by construction; the mutation turns both red.

`actor-assertion.test.ts` was already correct here - it used `createHmac('sha256', 'not-the-key')`
from the start. The two route tests copied the shape of the idea and not the property.

#### Local CodeRabbit CLI round (0.7.3, `9fb1c41`)

`review_completed`, 20 of 20 diff files reviewed, 5 findings. Three confirmed, two refuted.

| # | Severity | Finding | Verdict |
| --- | --- | --- | --- |
| 1 | trivial | `route.test.ts` should use `ACTOR_ASSERTION_AUDIENCE`/`_TTL_MS` instead of the `'tools/v1'` and `60_000` literals | **Refuted** |
| 2 | trivial | `actor-assertion.test.ts` never reaches the claim guards, or a non-string assertion | **Confirmed** |
| 3 | major | `chat-client.ts` should require the signing key to be base64url decoding to >=32 bytes | **Refuted** |
| 4 | minor | `test_chat_service.py` never sends a non-string `actorAssertion` | **Confirmed** |
| 5 | minor | `test_relay_holds_no_key.py`'s collector is over-broad, and nothing proves it detects a read | **Confirmed in part** |

**1 - refuted, and it is backwards.** The literal `'tools/v1'` in the test is what makes it sensitive
to a change in the constant: the test mints with the literal and the route verifies with the
constant, so if the constant moved, the test would fail. Replacing the literal with the constant
would make both sides read the same value and the test blind to exactly the change it currently
catches. The literal is the pin, not a duplication.

**2 - confirmed, and the most valuable of the five.** Four guards inside `verifyActorAssertion` were
reachable only by a **correctly signed** payload, and no test signed one: a malformed-JSON case stops
at the parse. The one that matters is a non-numeric `exp` - with that guard removed,
`now >= claims.exp` compares a number against a string, which is `false`, and **the assertion never
expires**. Silent, permanent, and invisible to every other test in the file. Each of the four guards
is now mutation-proved: 4, 4, 2 and 5 cases fail respectively.

**3 - refuted, and it is a policy change rather than a defect.** It would refuse a perfectly good
high-entropy passphrase for not being base64url, and it is inconsistent with the two sibling
secrets: `verifyServiceToken` requires only that `AGENT_SERVICE_TOKEN` and `GATEWAY_SERVICE_TOKEN`
be non-blank. Making one of three secrets stricter, in the adapter rather than in the shared
primitive, spreads the rule rather than establishing it. Worth raising as its own decision across
all three, not settling here. **Action item.**

**4 - confirmed.** `payload.get` returns `None` when the key is absent, so the absent case exercised
the `isinstance` guard through the branch a wrong *type* would take, and the distinct case was never
driven. Five type cases added.

**5 - confirmed in part, and it found a vacuity in the file written to prevent vacuity.** The
valuable half: **nothing proved the collector finds anything.** Every assertion in the file is
satisfied by `_environment_names()` returning the empty set, which is what a broken AST walk, a
renamed package or a wrong root produces - and the package by design contains no key, so scanning
the real source can never demonstrate the collector works. Closed with a fixture module that reads a
key four ways; breaking the walk now turns two cases red where it previously turned none.

The other half - narrow the collector to `os.getenv`/`os.environ.get` by name - is **declined and
recorded**: the breadth is deliberate. The pattern that matters is the one nobody predicted (a
settings wrapper, a `dotenv` call, a name passed through a constant), and matching the two spellings
anybody would think of is precise about exactly the cases that were never the risk. The fixture
includes a wrapper call for that reason.

**Ingest:** the two refuted findings were removed from the stream before `argus_ingest`, so the
false positive at `major` could not be written to memory as an Argus miss. Joined on `9fb1c41`, 1
review compared, 0 skipped, 0 lessons - Argus and CodeRabbit agreed at critical/major.

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Split from 5.1b after a CodeRabbit finding on MR !71; the finding's stated mechanism was refuted and the real one recorded |
| 2026-08-21 | Widened on Matt's instruction after !71 merged: the SQL scanner replacement joins the actor token, both being properties asserted by resemblance rather than construction |
| 2026-08-21 | AD-18 written and the parser dependency approved — both blockers cleared, story is implementable once the spine change merges |
| 2026-08-21 | Context pass: the seven-file chain read and recorded, four design decisions made, ready-for-dev |
| 2026-08-21 | Narrowed back to the actor after task 2: the parser half becomes story 5.1d |
| 2026-08-21 | Task 4: the Python relay carries the assertion and is proved unable to mint one |
| 2026-08-21 | 4b/4c: the AC audit found an unproved db-level refusal, and mutation found the forgery too short to test the signature check |
| 2026-08-21 | CodeRabbit CLI round: 3 of 5 confirmed; four claim guards had no test that could reach them |
| 2026-08-21 | Tasks 3 and 5: the expiry window gains a bound that can fail, and `actorId` is refused rather than ignored. All tasks complete |
