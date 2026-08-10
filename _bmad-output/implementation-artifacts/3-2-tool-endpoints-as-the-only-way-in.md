---
baseline_commit: 6b5d06a
merge_request: 37
---

# Story 3.2: Tool endpoints as the only way in

Status: review

## Why this story exists

Story 3.1 built the catalog, the executor and the provenance log, and **nothing can reach any of
it**. Verified by search: `createCatalogExecutor` has no caller outside its own module. That was the
declared boundary — 3.1's story file says so — and this is the story that closes it.

AD-15 is the invariant: *"The Python agent service reaches Node only through versioned `/tools/*`
endpoints, which are the sole data path in the system and must reject any caller that is not the
agent service."* Two claims, and the story is only done when both are provable — that the endpoints
exist and reject a stranger, **and** that nothing else offers a way in.

AD-3 is the other half: *"The Python agent service holds exactly one secret — the model API key —
and never a database credential."* It obtains every fact by calling here. That makes this endpoint
the entire data surface of the reasoning side, which is a small amount of code carrying an unusual
amount of weight.

### The gap this story cannot close, stated up front

AD-15's mechanism has two parts: the endpoints are **bound to the Railway private network**, and the
caller is identified by a **shared service token**. The epic file records the decision of 2026-08-07:

> The Railway private network AD-15 assumes does not exist yet. Stories 3.2 and 3.3 build against
> localhost with the service-token check enforced in code; the private-network binding is a
> deployment task, and AD-15's network half stays untested until then. That is a known gap, recorded
> rather than glossed.

So this story delivers the token half in full and **cannot** deliver the network half. The
consequence must be stated where an operator will read it, not just here: until the endpoints are
bound to a private network, the token is the only thing standing between the internet and the
catalog. The architecture assumed the two would share the load.

### What this story is not

| Not this story | Whose it is |
| --- | --- |
| The Python service, CrewAI, pytest in the gate | 3.3 |
| A model choosing an entry; `strict` tool definitions | 3.4 |
| The pre-render numeric validator | 3.5 |
| Any user-visible surface | 3.6, 3.7 |
| Reading the provenance log back | 3.8 |
| Binding the endpoints to a private network | deployment, not a story |

## Story

As the board,
I want the reasoning side to reach the association's records through one authenticated, versioned
endpoint and no other route,
so that the data surface exposed to an LLM is a thing we can point at, review, and prove is closed
to everyone else.

## Acceptance Criteria

1. **A versioned tool endpoint exists and executes a catalog entry.** `POST /tools/v1/catalog/execute`
   takes an entry id, a version, parameters and an actor, and returns the rows and the provenance id
   that story 3.1's executor produces. The path is versioned in the URL, per AD-15's "versioned
   `/tools/*` endpoints".

2. **A caller without a valid service token is rejected before any work happens.** No catalog entry
   is resolved, no parameters are validated, no provenance row is written and no query runs. The
   response is `401` and names nothing about what exists behind it.

3. **A missing or blank token configuration fails closed.** With `AGENT_SERVICE_TOKEN` unset, the
   endpoint rejects **every** caller, including one presenting no token at all. It never treats
   "nothing configured" as "nothing to check".

4. **The token comparison is constant-time and length-safe.** Comparison uses
   `timingSafeEqual` over byte buffers and cannot throw on a length mismatch, because a throw on
   unequal lengths is itself an oracle.

5. **The endpoint is outside the session gate, and the exclusion is anchored.** The agent has no
   session, so `proxy.ts`'s matcher must not send it to `/sign-in`. The exclusion matches the
   `/tools/` **prefix** and nothing else — not a suffix, and not a path that merely contains the
   word — proven by tests over the literal matcher, as `proxy.test.ts` already does for the others.

6. **The tool endpoint is the sole data path.** Nothing under `app/` other than this route reaches
   `createCatalogExecutor`, and a test proves it — the same shape as `core/ports/boundary.test.ts`.
   A second caller is the "ad-hoc endpoints accumulating" that AD-15 exists to prevent.

7. **Provenance is unchanged and still unbypassable.** A successful call writes exactly one
   `query_log` row naming the actor the request supplied. The endpoint adds no path that reaches the
   database without going through the executor.

8. **Errors use the one envelope and leak nothing.** `{code, message, detail?}` per the
   architecture's Consistency Conventions. A catalog miss, a bad parameter and an internal failure
   are distinguishable by `code`, and no response body carries a raw Postgres error, a SQL string or
   a stack trace.

## Tasks / Subtasks

- [x] **Task 1 — The service-token check, as a pure function (AC: 2, 3, 4)**
  - [x] `core/tools/service-token.ts` — `verifyServiceToken(presented, configured)` returning a
        typed result. No `next`, no I/O, no environment read: the environment is the adapter's
        problem, and a pure function is what lets the fail-closed case be tested exhaustively.
  - [x] Fail closed on a `configured` value that is absent, empty or whitespace-only. **This is the
        acceptance criterion most likely to be got wrong**, because the natural implementation
        (`if (!configured) return ok`) reads like a development convenience.
  - [x] `timingSafeEqual` over `Buffer.from(value, 'utf8')`, guarded so unequal lengths return false
        rather than throwing — Node throws on mismatched lengths, and a throw distinguishable from a
        false is a length oracle.
  - [x] Tests: correct token; wrong token of the same length; wrong token of a different length;
        empty presented; absent presented; configured absent/empty/whitespace; a presented value
        that is a prefix of the configured one.

- [x] **Task 2 — The endpoint (AC: 1, 2, 7, 8)**
  - [x] `app/tools/v1/catalog/execute/route.ts` — `POST`. Order: read the token header → verify →
        parse the body → execute. Rejection precedes parsing, so a malformed body from an
        unauthenticated caller is still a `401` and not a `400` that confirms the route exists.
  - [x] Header: `Authorization: Bearer <token>`. Parse it strictly; a missing, malformed or
        non-Bearer header is the same `401` as a wrong token.
  - [x] Body: `{ entryId, version, parameters, actorId }`. Validate shape before use and answer
        `400` with the envelope; the catalog's own `validateParameters` owns parameter *types* and
        its `ParameterValidationError` maps to `400`.
  - [x] Map failures: unknown entry/version → `404`; bad parameters → `400`; anything else → `500`
        with a generic message. **Log the detail, return the envelope** — never the provider's text.
  - [x] Tests alongside, in the style of `app/api/documents/[id]/extract/route.test.ts`.

- [x] **Task 3 — Out of the session gate, narrowly (AC: 5)**
  - [x] Add `tools/` to `proxy.ts`'s matcher negative lookahead, beside `api/auth/`, with a comment
        giving the same reason: this surface authenticates differently and the session gate can only
        turn it away.
  - [x] Extend `proxy.test.ts` to assert `/tools/v1/...` is not matched **and** that
        `/tools-of-the-trade`, `/x/tools/y` and `/atools/` still are. The matcher comment already
        records an earlier version that anchored to a suffix and unguarded whole routes.

- [x] **Task 4 — Prove it is the only way in (AC: 6)**
  - [x] `core/tools/sole-data-path.test.ts` — scan `app/` for anything reaching the catalog
        executor and assert the tool route is the only one. Detect every import form, as
        `core/ports/boundary.test.ts` does: `from`, side-effect `import`, dynamic `import()`,
        `require()`.
  - [x] **Test the detector against a planted violation**, or it is a guard that proves nothing —
        `boundary.test.ts` records five review rounds learning exactly that.

- [x] **Task 5 — Configuration and documentation (AC: 3)**
  - [x] `AGENT_SERVICE_TOKEN` in `.env.example`, with a comment saying it is the only thing
        authenticating the reasoning side until the private network exists.
  - [x] `README.md` and `docs/as-built.md`: both have tests that fail when the tree changes.
        `as-built.md`'s "What is not built" table needs the Oracle row amended again, and its
        baseline line moved to story 3.2.
  - [x] Record the AD-15 network gap where an operator reads it, not only in the story.

## Dev Notes

### The middleware collision, found by reading rather than by running

`proxy.ts`'s matcher is a negative lookahead over everything:

```
'/((?!_next/|api/auth/|favicon\\.ico$|robots\\.txt$|sitemap\\.xml$|manifest\\.webmanifest$|\\.well-known/).*)'
```

So `/tools/v1/...` **is** matched today, and `core/auth/route-policy.ts` is deny-by-default with no
prefix matching: `PUBLIC_ROUTES` holds `/sign-in` alone. An agent request would be answered with a
307 to `/sign-in` and never reach the handler.

The fix is the matcher, not the policy, and the reason is worth being precise about. `route-policy`
answers *"may this session see this route"*. The agent has no session and never will; it presents a
bearer token. Teaching a session policy about token callers would put two authentication schemes in
one deny-by-default list, and the list's own docblock explains why it has no prefix matching —
`/sign-in-secretly`. `api/auth/` is already excluded for the structurally identical reason: Auth.js
must serve unauthenticated callers.

**The cost of that exclusion is real and must be paid by a test.** Once `/tools/` is outside the
session gate, the token check in the handler is the *whole* of its protection. AC5's anchoring
assertions and AC2's rejection-before-work ordering are what stand in for the gate.

### Fail closed, and why the obvious implementation fails open

```ts
if (!configured) return { ok: true }   // wrong, and it reads like a convenience
```

An unset `AGENT_SERVICE_TOKEN` in production is the exact circumstance where the endpoint is most
exposed — a fresh deploy, a renamed variable, a secret that did not propagate. Treating it as "no
check required" opens the catalog to the internet at the moment the operator is least likely to
notice. `readWriterDatabaseUrl` in `adapters/auth/env.ts` sets the house precedent: absent
configuration throws, it does not degrade.

### `timingSafeEqual` throws on unequal lengths

That is not a detail. `crypto.timingSafeEqual` requires equal-length buffers and throws
`RangeError` otherwise, so the naive wrapper leaks length through the difference between an
exception and a `false`. Compare lengths first and return false — the length of the configured token
is not a secret worth a branch, but it must not arrive as a *different kind* of outcome.

### Where the route file lives, and a deviation to record

The architecture's source tree lists `tools/` beside `app/`. Next.js serves route handlers only from
under `app/`, so the endpoint is `app/tools/v1/catalog/execute/route.ts`, which yields the path
`/tools/v1/catalog/execute` — AD-15's `/tools/*` literally, not `/api/tools/*`. Any pure logic goes
in `core/tools/`. Note the deviation in Project Structure Notes rather than silently doing something
the diagram does not show.

### The error envelope, and an existing inconsistency not to copy

Consistency Conventions: *"One envelope `{code, message, detail?}`."* `app/api/documents/[id]/extract/route.ts`
returns `{error: 'unauthenticated'}`, which does not match. Follow the **convention**, not the
neighbouring file, and leave that route alone — retrofitting it is not this story's, and changing a
response shape a surface already reads is a separate decision. Record it as deferred work.

### Learnings that apply directly

1. **A green unit test proves a part works; only a test that runs the path proves the parts are
   connected.** Three epic-2 stories exist because of this, and story 3.1 shipped an executor with
   no caller. The route test must exercise the real executor against the real database, not a fake.
2. **A guard that passes whether or not the thing it guards against is present is not a guard.** Both
   the sole-data-path detector (Task 4) and the matcher assertions (Task 3) must be run against
   planted violations.
3. **`toThrow(SomeType)` cannot tell a contract from a crash.** Story 3.1's MR round 1 raised three
   assertions that named no failure. Assert status codes *and* the envelope's `code`.
4. **Do not state a fact about a dependency without checking it.** 3.1 shipped a comment claiming
   `pg` throws on `undefined`; it does not. If a claim about `timingSafeEqual` or Next.js routing
   goes into a comment, run it first.
5. **Read the file count in the test summary, and never pipe the run through `head`.** 3.1 lost a
   run to `| head -N` SIGPIPEing the runner, which reads as a completed suite that collected fewer
   files. Run the gate to a file and grep the file.

### Testing standards

- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, and
  `npx --no-install tsc --noEmit` against its **baseline of 8**. Quote the numbers from the run.
- No Python yet, so no pytest and no gate change — that is story 3.3's obligation, and adding it
  early registers a gate nothing runs.
- The route test needs the real database for AC7: the provenance row is the assertion, and a fake
  executor cannot produce one. Per-file `RUN_PREFIX` on anything it seeds.
- `tsconfig.json` already covers `app/**` and `core/**`; a new top-level directory would need adding
  to `include`, and `tsconfig-coverage.test.ts` will say so if one appears.

### If this has to be cut

Cut the endpoint's surface, never its guard. AC2, AC3, AC4 and AC5 are the story — an endpoint that
executes nothing but rejects correctly is a safe half. Shipping execution without fail-closed token
verification would put the catalog on the public internet, which is the one outcome worse than not
shipping.

### References

- `_bmad-output/planning-artifacts/architecture/…/ARCHITECTURE-SPINE.md` — AD-15, AD-3, AD-12;
  Consistency Conventions (errors, tool contracts); the two-runtime container diagram.
- `_bmad-output/planning-artifacts/epics.md` §Epic 3 — the spine row and the 2026-08-07 deployment
  note that bounds this story.
- `_bmad-output/implementation-artifacts/3-1-the-catalog-executed-and-logged.md` — the executor this
  wires, its ordering guarantee, and the review learnings above.
- `proxy.ts` and `core/auth/route-policy.ts` — the matcher to amend and the policy not to.
- `app/api/documents/[id]/extract/route.ts` — the route shape to follow, and the error envelope not
  to copy.
- `core/ports/boundary.test.ts` — the import-detection shape Task 4 reuses, and its planted-violation
  discipline.
- `adapters/auth/env.ts` — the house precedent for configuration that fails closed.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Test Design

Four behaviours. Failure modes classified before any test was written.

#### B1 — `verifyServiceToken` (Task 1)

| Failure mode | Class | Forced by |
| --- | --- | --- |
| **Unconfigured token treated as "nothing to check"** | GUARD | six cases; the mutation below proves it |
| Wrong token, same length | GUARD | equal-length case |
| Wrong token, different length — `timingSafeEqual` throws | GUARD | asserted as `false`, not a throw |
| A prefix of the configured token | GUARD | explicit case |
| Non-string presented (null, number, object) | GUARD | `it.each` |
| Byte length vs character length on multi-byte input | GUARD | `café` / `cafe` |
| Comparison is constant-time | PROPAGATE→source | asserted by reading the module for `timingSafeEqual`; stated limit |

#### B2 — the route (Task 2)

| Failure mode | Class | Forced by |
| --- | --- | --- |
| **Executor reached before the caller is verified** | GUARD | `expect(execute).not.toHaveBeenCalled()` |
| A malformed body from a stranger answered 400, confirming the route | GUARD | bad token + bad body → 401 |
| Non-Bearer or absent scheme accepted | GUARD | `Token <t>` case |
| Body shape unvalidated → executor receives rubbish | GUARD | six shape cases |
| A Postgres error reaching the caller | GUARD | asserts the body carries no table/SQL text |
| Envelope drift back to `{error}` | GUARD | `{code, message}` asserted, `error` absent |

#### B3 — the session gate (Task 3)

| Failure mode | Class | Forced by |
| --- | --- | --- |
| `/tools/*` redirected to `/sign-in`, unreachable by the agent | GUARD | two exclusion cases |
| **Exclusion widened past the prefix** | GUARD | five anchoring cases; mutation proves them |

#### B4 — sole data path (Task 4)

| Failure mode | Class | Forced by |
| --- | --- | --- |
| A second caller reaches the executor | GUARD | sweep over `app/`, proven with a planted file |
| Detector blind to an import form | GUARD | seven forms, incl. dynamic, require, wrapped |
| Detector reports a comment or string | GUARD | four negative cases |
| Sweep passes vacuously over nothing | GUARD | file count and `THE_DOOR` pinned |

### Debug Log References

**Task 1 red:** 17 assertion failures against a stub returning `true`.

**Task 2 red:** 16 failures against a stub returning 500.

**Task 3 red:** the two exclusion cases failed and the five anchoring cases passed — the matcher
already guarded `/toolsmith` and friends, so only the intended hole needed opening.

**Task 4** went green on first run, which is why the planted-violation check below matters more than
the unit cases.

**The collision found by reading, not by running.** `proxy.ts`'s matcher is a negative lookahead over
everything except `_next/`, `api/auth/` and a few filenames, and `core/auth/route-policy.ts` is
deny-by-default with no prefix matching. `/tools/v1/...` was therefore matched and would have been
answered with a 307 to `/sign-in` — which the agent, holding a bearer token and no session, can never
satisfy. Found before writing the route rather than while debugging it.

### Review Findings

### Completion Notes List

**What was built.** `core/tools/service-token.ts` (pure, fail-closed, constant-time),
`app/tools/v1/catalog/execute/route.ts` (the endpoint), the `tools/` exclusion in `proxy.ts`, and
`core/tools/sole-data-path.test.ts` — the test that makes AD-15's "sole data path" a property rather
than a sentence.

**Fail-closed is the acceptance criterion most likely to be lost later**, because the shape that
breaks it (`if (!configured) return true`) reads like a development convenience. It is guarded by six
tests and by the mutation below, and the reason is written in the function, in `.env.example` and in
`docs/as-built.md`.

**AD-15's network half is not delivered and cannot be by this story.** The Railway private network
was deferred on 2026-08-07 and is a deployment task. Until it exists, `AGENT_SERVICE_TOKEN` is the
only thing between the public internet and the catalog. Recorded in `.env.example` where an operator
setting up a deploy will read it, and in `docs/as-built.md` as a known gap.

**Sensitivity checks run (four, each restored and re-verified):**

1. Fail-closed → fail-open: 6 tests failed.
2. `Object.hasOwn`-style own-property equivalent — not applicable here; instead the exclusion
   `tools/` → `tools`: 3 anchoring tests failed (`/tools`, `/toolsmith`, `/tools-of-the-trade`).
3. A real second caller planted at `app/dashboard/dues-widget.ts`: the sole-data-path sweep failed
   and named the file. The detector's unit cases could not have caught a sweep that walked the wrong
   directory; this one could.
4. The route's stub (500 for everything) against the finished test list: 16 failures.

**A gate was widened, so it was registered.** The end-to-end route test needs the real database — AC7
is a `query_log` row and no mock can produce one — and `npm run test:db` walked only `migrations/`
and `adapters/db/`. It now walks `app/tools/` too, and the "Tested =" line in `bmad-ship-story` was
updated in both places it appears so the next run inherits it. A gate nobody knows to run is not a
gate.

**Deferred, recorded rather than fixed:** `app/api/documents/[id]/extract/route.ts` answers
`{error: 'unauthenticated'}`, which is not the architecture's `{code, message, detail?}` envelope.
This route follows the convention; retrofitting that one changes a response shape a surface already
reads, which is a separate decision.

**Gate** — `npm run lint` exit 0 (1 pre-existing warning); `npm run build` exit 0; `npm test` exit 0,
**98 passed | 19 skipped across 117 files**, 1824 tests; `npm run test:db` exit 0, **40 files, 647
passed**; `npx --no-install tsc --noEmit` **8 errors, exactly the baseline**. Run to files and
grepped, never piped through `head` — story 3.1 lost a run to `| head -N` SIGPIPEing the runner.

### File List

**Added**

- `core/tools/service-token.ts`
- `core/tools/service-token.test.ts`
- `core/tools/sole-data-path.test.ts`
- `app/tools/v1/catalog/execute/route.ts`
- `app/tools/v1/catalog/execute/route.test.ts`
- `app/tools/v1/catalog/execute/route.db.test.ts`

**Modified**

- `proxy.ts` — `tools/` added to the matcher exclusion, with the reason.
- `proxy.test.ts` — two exclusion cases and five anchoring cases.
- `package.json` — `test:db` widened to `app/tools/`.
- `.claude/skills/bmad-ship-story/SKILL.md` — the "Tested =" line, both occurrences.
- `.env.example`, `README.md`, `docs/as-built.md` — the new variable, the count, the AD-15 gap.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

| Date | Change |
| --- | --- |
| 2026-08-10 | Story created |
| 2026-08-10 | Tasks 1-5 implemented test-first; gate green; test:db widened to app/tools/ |
