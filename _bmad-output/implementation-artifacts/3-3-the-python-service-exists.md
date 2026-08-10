---
baseline_commit: 99d0d31
merge_request: 39
---

# Story 3.3: The Python service exists

Status: done

## Why this story exists

Story 3.2 built the door — `POST /tools/v1/catalog/execute`, authenticated by bearer token, the
catalog's only way in — and **nothing walks through it**. The agent service that AD-3 and AD-15 are
written about does not exist. `ls`: there is no `agent/` directory and no `.py` file anywhere outside
`.agents/` tooling.

This story makes the second runtime real, and proves the one property that makes the architecture's
safety claim true rather than decorative:

> **AD-3** — "The Python agent service holds exactly one secret — the model API key — and never a
> database credential, connection string, or storage key. It obtains every fact by calling Node's
> tool endpoints. A code path that gives the agent service data access is a violation, not an
> optimization."

A second runtime that could reach Postgres directly would make every guarantee in stories 3.1 and 3.2
pointless — the catalog, the provenance log and the token check all sit on one path, and AD-3 is what
says there is no second one.

### The critical path item, and it is this story's to carry

The epic file is unusually direct about the way this story goes wrong:

> Story 3.3 introduces Python and **must add `pytest` to the local gate in the same story** — a
> `package.json` script *and* the "Tested =" line in `bmad-ship-story`'s Project facts, so the next
> run inherits it. […] a second language arrives with no automated check of any kind behind it. That
> makes the local gate list the only place it can be registered, and makes forgetting it the most
> likely way Epic 3 ships untested Python.

There is no CI (AD-2's amendment, 2026-08-07). A `pytest` nobody runs is not a gate.

### The runtime trap, verified rather than assumed

**The ambient interpreter cannot host this service.** Checked on this machine, not inferred:

| What | Version |
| --- | --- |
| `python3` / `py` (ambient) | **3.14.6** |
| `py -3.13` | **3.13.14** — has `venv`, `pip 26.1.2` |
| `pytest` globally | **not installed** |

AD-15 states the constraint and the reason: *"The Python service pins **Python 3.13** — CrewAI's
`requires_python` is `<3.14,>=3.10`, so the ambient 3.14 interpreter cannot host it."* So
`python3 -m venv` — the obvious command, and the one a reader will reach for — builds an environment
CrewAI can never be installed into. Every invocation in this story must go through **`py -3.13`**, or
through a virtual environment created from it.

### What this story is not

| Not this story | Whose it is |
| --- | --- |
| CrewAI itself, and any model call | 3.4 |
| The model choosing a catalog entry | 3.4 |
| The numeric validator | 3.5 |
| Any user-visible surface | 3.6, 3.7 |
| Binding the two runtimes to a private network | deployment, not a story |

**CrewAI is deliberately not installed yet.** It is a heavy dependency whose only consumer is story
3.4, and installing it here would be speculative. What this story owes CrewAI is the **3.13 pin** —
recorded, enforced by a test, and explained — so that 3.4 finds an interpreter it can actually use.

## Story

As the board,
I want the reasoning runtime to be a separate service that holds no database credential and can only
obtain facts by calling the gateway's tool endpoint,
so that the safety of the whole query path rests on something structural rather than on the agent
being well behaved.

## Acceptance Criteria

1. **A Python service exists under `agent/`, pinned to 3.13.** The pin is recorded in a file
   (`.python-version` and the project metadata), and a test asserts the running interpreter satisfies
   `>=3.10,<3.14` — the range AD-15 quotes from CrewAI — so a 3.14 environment fails loudly rather
   than at `pip install` time in story 3.4.

2. **It obtains catalog facts only by calling the gateway.** A client module calls
   `POST /tools/v1/catalog/execute` with `Authorization: Bearer <token>`, passes an entry id, a
   version, parameters and an actor, and returns the rows and provenance id.

3. **It holds no database credential, connection string or storage key (AD-3).** A test asserts this
   the way `core/security/nfr2-guard.test.ts` asserts NFR-2: over the service's environment, its
   committed configuration and its dependency list — not merely over the code it happens to contain
   today. A `psycopg`, `sqlalchemy`, `asyncpg` or `boto3` dependency is a violation the test names.

4. **It fails closed with no token.** With `AGENT_SERVICE_TOKEN` unset, the client refuses to make
   the call at all rather than sending an unauthenticated request the gateway will reject — the
   failure belongs where the misconfiguration is, and an unauthenticated request in the gateway's log
   is a worse diagnostic than an error here.

5. **The gateway's refusal is surfaced, not swallowed.** A `401` from `/tools/v1/*` raises a distinct,
   named error; a `404` (unknown entry) and a `400` (bad parameters) are each distinguishable from a
   transport failure. The service never treats a non-2xx as an empty result set.

6. **`pytest` is in the local gate.** A `package.json` script runs it, and the **"Tested =" line in
   `bmad-ship-story`'s Project facts names it**, so the next story inherits the obligation. Both, or
   the gate is a private habit.

7. **The Node side is unchanged.** This story adds no route, widens no token check and changes no
   catalog behaviour. `git diff --stat` over `app/`, `core/`, `adapters/` and `catalog/` shows only
   what AC6 requires.

## Tasks / Subtasks

- [x] **Task 1 — The service skeleton and its interpreter pin (AC: 1)**
  - [x] `agent/` with `pyproject.toml` (`requires-python = ">=3.10,<3.14"`, matching AD-15's quoted
        CrewAI range verbatim) and `.python-version` holding `3.13`.
  - [x] `agent/tests/test_interpreter.py` — asserts `sys.version_info` is inside the declared range,
        and that the range in `pyproject.toml` is the one AD-15 states. **Two statements of one rule,
        with something failing on disagreement**, which is migration 007's standard.
  - [x] A venv created with **`py -3.13 -m venv`**, never `python3 -m venv`. Record the command where
        a reader will hit it — `agent/README.md` — because the ambient interpreter is 3.14.6 and the
        obvious command silently produces an environment CrewAI cannot be installed into.

- [x] **Task 2 — The tool client (AC: 2, 4, 5)**
  - [x] `agent/watchdog_agent/tools_client.py` — `execute_catalog_entry(entry_id, version, parameters, actor_id)`.
  - [x] Reads `AGENT_SERVICE_TOKEN` and the gateway base URL from the environment. **Absent token
        raises before any request is made** (AC4); an absent base URL likewise.
  - [x] Maps the gateway's envelope: `401` → a named auth error, `404` → unknown entry, `400` →
        invalid request/parameters, other non-2xx → a transport/server error. Each carries the
        envelope's `code` where one was returned, and none is silently converted to "no rows".
  - [x] Tests with a stubbed transport — no network in the suite. Cover each status, a non-JSON body,
        and a 2xx whose body is missing `rows`.

- [x] **Task 3 — AD-3, asserted (AC: 3)**
  - [x] `agent/tests/test_no_data_credentials.py` — the AD-3 guard, modelled on
        `core/security/nfr2-guard.test.ts`. Three surfaces: the process environment, every committed
        config file under `agent/`, and the declared dependencies.
  - [x] Name the forbidden things explicitly: any variable matching a database URL or DSN shape, any
        S3/R2 key, and any dependency in the driver families (`psycopg*`, `asyncpg`, `sqlalchemy`,
        `pg8000`, `boto3`, `botocore`, `minio`).
  - [x] **Test the detector against planted violations** — a fake env var and a fake dependency line.
        `core/ports/boundary.test.ts` records five review rounds learning that a scanner which
        reports green on its own subject matter is worse than none.

- [x] **Task 4 — The gate (AC: 6)**
  - [x] `package.json`: `"test:py": "py -3.13 -m pytest agent"` (or the venv's pytest, if Task 1
        settles on one — whichever it is, the script must not resolve to the ambient 3.14).
  - [x] `bmad-ship-story`'s **"Tested =" line**, both places it appears, naming `npm run test:py`.
  - [x] `README.md` and `docs/as-built.md`: the new runtime, the 3.13 pin and the reason. Both have
        tests that fail when the tree changes.

## Dev Notes

### `python3` is 3.14.6 here, and that is the whole hazard

```
python3 --version   →  Python 3.14.6      # ambient, and CrewAI cannot use it
py -3.13 --version  →  Python 3.13.14     # has venv, pip 26.1.2
py -3.13 -m pytest  →  No module named pytest
```

CrewAI's `requires_python` is `<3.14,>=3.10`. So the failure mode is not "Python is missing" — it is
"Python is present, one minor version too new, and everything works until story 3.4 tries to install
CrewAI." Pinning is what turns that into an error today. AC1's test is the pin's enforcement; the
`.python-version` file is its declaration.

### The AD-3 test is the story, and it must not be a code scan

The tempting implementation is "grep the service for `psycopg`". That passes forever and proves
nothing: AD-3 is about what the runtime *can reach*, not what today's source happens to import. The
three surfaces in Task 3 are chosen to match `nfr2-guard.test.ts`'s reasoning — an absent credential
is the enforcement, so the test looks where credentials live, not where imports do.

It is also the test most likely to be written vacuously. A sweep over an empty dependency list, or an
environment that happens to hold nothing in the test runner, passes trivially. Plant the violations.

### The client fails closed, and the failure belongs here

AC4 is a small decision with a real reason. Sending an unauthenticated request and letting the
gateway answer `401` would "work" — the caller still gets an error. But the diagnostic lands in the
wrong place: the gateway's log fills with rejected callers that are actually a misconfigured
deployment of its own agent, which is indistinguishable from someone probing the endpoint. Refusing
locally puts the error where the missing variable is.

`app/tools/v1/catalog/execute/route.ts` made the mirror-image decision on the other side, and
`core/tools/service-token.ts` fails closed for the same family of reasons.

### Learnings that apply directly

1. **A story adding a gate must register it.** This is the one the epic file singles out. Both the
   `package.json` script and the "Tested =" line, or the next run does not know to run it.
2. **A guard that passes whether or not its subject is present is not a guard.** Story 3.2 shipped
   two — a `toContain('timingSafeEqual')` satisfied by the import alone, and a page scanner that
   reported nothing on a clean tree with its regex removed. Both were caught by review, not by the
   suite. Plant the violation.
3. **Do not state a fact about a dependency without running it.** Story 3.1 shipped a comment
   claiming `pg` throws on `undefined`; it does not. Every version claim in this story was checked
   against the machine and the numbers are in the table above.
4. **Two statements of one rule need something that fails on disagreement.** The interpreter range
   appears in `pyproject.toml` and in AD-15. AC1 makes them check each other.
5. **Run the gate to a file and grep the file** — never `npm test | head`, which SIGPIPEs the runner
   and reads as a completed suite that collected fewer files.

### Testing standards

- Gate: `npm run lint`, `npm run build`, `npm test`, `npm run test:db`, **`npm run test:py`** (new),
  and `npx --no-install tsc --noEmit` against its baseline of **8**.
- `npm run test:db` currently runs `migrations/`, `adapters/db/` and then `app/tools/` as a **second
  sequential invocation** — story 3.2 split it because running them together made
  `roll-ingestion.test.ts` time out on about one run in three. Do not recombine them.
- Python tests need no network and no database. If a test wants either, the design is wrong: the
  client takes its transport as a parameter.

### If this has to be cut

Keep Task 1, Task 3 and Task 4 — the pin, the AD-3 assertion and the gate. A service that exists,
proves it holds no data credential and is covered by a registered test runner is a genuine half. The
client (Task 2) is the part story 3.4 can also drive out.

Cutting Task 4 is the one thing that must not happen: it is the failure the epic file predicts by
name.

### References

- `_bmad-output/planning-artifacts/architecture/…/ARCHITECTURE-SPINE.md` — AD-3, AD-15 (including the
  `requires_python` range and the 3.13 pin), the two-runtime container diagram, and the Stack table.
- `_bmad-output/planning-artifacts/epics.md` — the 3.3 spine row and the critical-path item quoted
  above.
- `_bmad-output/implementation-artifacts/3-2-tool-endpoints-as-the-only-way-in.md` — the endpoint this
  calls, its envelope, its status mapping, and the review learnings above.
- `core/security/nfr2-guard.test.ts` — the three-surface shape Task 3 mirrors.
- `app/tools/v1/catalog/execute/route.ts` — the wire contract: header, body, statuses, envelope.
- `core/tools/service-token.ts` — the fail-closed precedent on the other side of the wire.

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Test Design

Three behaviours. Failure modes classified before any test.

#### B1 — the interpreter pin (Task 1)

| Failure mode | Class | Forced by |
| --- | --- | --- |
| **The venv is built from the ambient 3.14** | GUARD | asserted against `sys.version_info`, not a declaration |
| `pyproject.toml`'s range drifts from AD-15's | GUARD | both asserted, so disagreement fails |
| `.python-version` allows any in-range version | GUARD | pinned to `3.13` exactly |

#### B2 — the tool client (Task 2)

| Failure mode | Class | Forced by |
| --- | --- | --- |
| **A non-2xx becomes an empty result set** | GUARD | seven statuses, each asserted to raise |
| Missing token → an unauthenticated request the gateway rejects | GUARD | transport asserted never called |
| Blank token or missing gateway URL | GUARD | separate cases |
| 401 / 404 / 400 indistinguishable from each other | GUARD | distinct classes, `code` asserted |
| A non-JSON error body crashes instead of reporting the status | GUARD | HTML body case |
| A 2xx missing `rows` or `provenanceId` read as an answer | GUARD | both cases |

#### B3 — AD-3 (Task 3)

| Failure mode | Class | Forced by |
| --- | --- | --- |
| A driver in the dependency list | GUARD | family prefixes, planted violation |
| A credential in committed config | GUARD | DSN shape and name shape, planted |
| **The service reads a data credential from the environment** | GUARD | source sweep, planted |
| The sweep passes over nothing | GUARD | non-empty assertions per surface |
| A new variable appears unclassified | GUARD | exhaustive: reads *exactly* two |

### Debug Log References

**Task 1 red:** 2 of 3 failed — `pyproject.toml` and `.python-version` absent. The interpreter
assertion passed, which is the point: the venv really is 3.13.14.

**Task 2 red:** 16 failures against a stub raising `NotImplementedError`.

**Two vacuous guards, both caught here rather than in review.**

The first: `test_the_service_reads_no_data_credential_from_its_environment` passed while
`watchdog_agent/` was empty — there were no source files to sweep. Pinned with a non-empty assertion
once the client landed.

The second is the more interesting one. The detector matched call sites —
`os.environ["X"]`, `os.getenv("X")` — and `tools_client.py` reads through a module constant:

```python
TOKEN_VARIABLE = "AGENT_SERVICE_TOKEN"
...
os.environ.get(variable)
```

so it found **nothing**, and passed by seeing no variables at all. It was caught by the *exhaustive*
assertion ("reads exactly these two"), not by the absence one — which is the argument for writing
both. The detector now matches every upper-snake string literal: coarser, and it cannot miss the
indirection.

**`pytest` wrote `.pytest_cache/` to the repository root**, which `docs/readme.test.ts` caught as an
undocumented top-level directory. Pointed at `.venv/.pytest_cache` instead — inside something already
ignored — rather than adding a `.gitignore` rule, because `.gitignore` carries an unrelated
uncommitted change and a build artefact is not a good reason to entangle it.

#### Local round — Argus four times, then one CodeRabbit CLI round

Argus first, its finding fixed, re-run until it called the whole story clean — then the CLI round
found **five more** on exactly that code. Ingested against `6fcb18c`.

- **The credential regex missed the shapes that matter.** It anchored the PG branch to string-start
  or underscore, so `"PG_PASSWORD": "x"` and `export POSTGRES_HOST=…` — a JSON key and a shell
  export — both walked through. Verified as real misses by running the scanner, not by reading it.
- **A network failure was not this client's problem, and should have been.** Only `HTTPError` was
  caught, so `URLError` and `TimeoutError` escaped and a caller correctly handling `GatewayError`
  still died on a network blip.
- **`provenanceId` was coerced, not checked.** `str(None)` is `'None'` — an id that looks like one
  and identifies nothing, on a field AD-12 makes part of what an answer means.
- **Two guards had no test** — rows-not-a-list and the trailing-slash base URL.
- The env-var detector moved from a regex to `ast`, so a comment mentioning `DATABASE_URL` is no
  longer reported as a violation.

**Two vacuous guards, caught by my own tests rather than by review.** The AD-3 source sweep passed
while `watchdog_agent/` was empty; and its detector matched *call sites* while the client reads
through a module constant, so it found nothing and passed by checking nothing. The **exhaustive**
assertion ("reads exactly these two") caught that, not the absence one — which is the argument for
writing both.

One suggestion was declined by building **less**: a draft asserted that any transport raising
anything became a `GatewayError`. `Transport`'s contract is to return `(status, body)`, so catching
everything a substituted transport throws would turn a `TypeError` in a bad stub into a plausible
network error and hide the bug.

#### Merge request !39 — four rounds, and every one found something in the last one's fixes

That is the pattern `_bmad/custom/review-gate.md` predicts about fix diffs, observed four times in a
row.

**Round 1 — six findings.** The two that mattered were in the security test itself:

- **It would have printed credentials.** The finding carried 60 characters of the matching line, and
  the assertion prints findings on failure — so the first time it ever fired in earnest, on a real
  `.env`, it would have pasted the password into the terminal and any log capturing it. A security
  test that leaks on failure only leaks when somebody is already looking. It reports a category and a
  line number now.
- **It missed `PGPASSWORD`.** The regex required an underscore after `PG`, and libpq's real
  variables have none — `PGPASSWORD`, `PGUSER`, `PGHOST`. It was blind to precisely the names it
  most needed to catch.

Also: the denylist gained an **allowlist** beside it, because a list of drivers somebody thought of
was missing `pymysql`, `pymongo`, `aioboto3` and `google-cloud-storage`; and the 3.10 floor was
honoured with a conditional `tomli` rather than documented away.

**Round 2 — five findings, and one was a hole round 1 opened.** `run-pytest.mjs` picked the first
venv that existed and ran it, with only `test_interpreter.py` to object if that venv were 3.14 — and
round 1 had added argument forwarding, so `npm run test:py -- -k token` deselects that test. **The
gate could be made to report green from the exact interpreter AD-15 forbids.** The launcher now
refuses a venv that does not match the pin, before pytest starts.

Three security fixes in the transport in the same round: `GATEWAY_BASE_URL` restricted to absolute
HTTPS (`urllib` opens `http:`, `ftp:` and `file:`, and an `http://` gateway sends the token in
clear); `build_opener`'s default `ProxyHandler` replaced with an empty one (it reads `HTTPS_PROXY`
from the environment); and Azure and Google credential names added, which the dependency denylist
already covered and the name list did not.

**Round 3 — four findings, and the first had been visible in every run since I wrote it.** The
transport-failure test patched `urllib.request.urlopen` while the transport had been changed to call
`opener.open`. The patch intercepted nothing, the test made a **real DNS lookup** to
`nowhere.invalid`, and it passed because that failed — proving DNS behaviour rather than the wrapping
it claims to test, and breaking the file's stated no-network guarantee.

The tell was in the output the whole time: that one test took **11.10 of the suite's 11.25 seconds**,
up from 0.2s before it existed, and "41 passed in 11.25s" was read repeatedly without anyone asking
why a suite with no I/O took eleven seconds. Patching `OpenerDirector.open` puts it at 0.02s and the
suite back to 0.17s.

Also: the pin check only checked *agreement*, so a `.python-version` of `3.14` and a matching 3.14
venv agreed with each other and passed — both outside AD-15's range. The pin is validated against the
range first now, verified at both bounds. And the Windows recovery commands were not runnable in
`cmd.exe` (`# Windows` is an argument there, `rm -rf` is not a command), while the mismatch message
asserted the venv was 3.14 even when it was 3.12.

**Round 4 — clean.** `No actionable comments were generated` over `29cfc13..da3fb2f`.

**A watcher note worth keeping.** That clean review arrived as an **edit to an existing note** —
created 21:29, updated 23:22, same id. Story 3.2's watcher keyed recency off the note id and missed
exactly this, costing two rate-limit back-offs; the fix was applied before this round and it is why
the review was seen at all. **The recency key for a CodeRabbit review is `updated_at`.**

**One finding deliberately unresolved: the AD-3 / AD-15 contradiction.** AD-3 says the agent holds
"exactly one secret — the model API key"; AD-15's mechanism, decided later on 2026-07-31 and marked
*previously deferred*, requires "a shared service token held only by the agent service and the
gateway". Both cannot be true as written. This story implements both and enforces the half they
agree on — no database credential, connection string or storage key. Amending AD-3 is a change to the
security contract and belongs to the project lead; CodeRabbit agreed, marking its thread unresolved
by design. Ledgered.

### Completion Notes List

**What was built.** `agent/` with the 3.13 pin enforced against the running interpreter, a tool
client that is the service's only way to obtain a fact, the AD-3 guard across three surfaces, and
`npm run test:py` wired into the local gate.

**The trap this story exists to avoid, verified on the machine:** ambient `python3` is **3.14.6**;
CrewAI's `requires_python` is `<3.14,>=3.10`; `py -3.13` is **3.13.14**. So `python3 -m venv` builds
an environment CrewAI can never be installed into and nothing says so until story 3.4. The pin is
asserted against `sys.version_info` rather than declared, so a wrong venv fails the suite.

**The gate was registered, which is the item the epic file names by name.** `npm run test:py` in
`package.json`, and the "Tested =" line in `bmad-ship-story` in **both** places it appears, plus the
Project-facts note about the ambient interpreter. `scripts/run-pytest.mjs` **refuses** when the venv
is missing rather than falling back to whatever `python` means — a gate that runs on the wrong
runtime reports green from an environment the service cannot use. It handles both venv layouts, since
development is Windows and the deploy target is Linux.

**Every non-2xx raises.** A client returning `[]` on a `401` would turn "you are not authorised" into
"this unit owes nothing" — a wrong financial answer delivered confidently, which is what this product
exists to prevent. A `2xx` without `provenanceId` is also an error: AD-12 makes that id part of what
an answer means, so a result without one came from a path that did not log.

**Sensitivity checks (each restored and re-verified):**

1. `dependencies = ["psycopg[binary]>=3.1"]` and a `WATCHDOG_READER_DATABASE_URL` constant planted in
   the client → **three** AD-3 assertions failed.
2. The client stubbed to `NotImplementedError` → 16 failures.
3. `pyproject.toml` / `.python-version` absent → the two declaration tests failed while the
   interpreter test passed.

**Deliberately not here:** CrewAI and any model call — story 3.4's. A heavy dependency whose only
consumer does not exist yet. What this story owes it is an interpreter it can use.

**Left alone:** `.gitignore` carries an uncommitted `.argus/` change that is not mine. I added a venv
rule there, then reverted it — the venv is already ignored by the file Python writes inside it, and
keeping an unrelated working change uncontaminated is worth more than belt-and-braces.

**Gate** — `npm run lint` exit 0 (1 pre-existing warning); `npm run build` exit 0; `npm test` exit 0,
**98 passed | 19 skipped across 117 files**, 1837 tests; `npm run test:db` exit 0, **623 + 25**;
**`npm run test:py` exit 0, 41 passed in 0.19s**; `npx --no-install tsc --noEmit` **8 errors, the baseline**.

### File List

**Added**

- `agent/pyproject.toml`, `agent/.python-version`, `agent/README.md`
- `agent/watchdog_agent/__init__.py`, `agent/watchdog_agent/tools_client.py`
- `agent/tests/test_interpreter.py`, `agent/tests/test_no_data_credentials.py`,
  `agent/tests/test_tools_client.py`
- `scripts/run-pytest.mjs`

**Modified**

- `package.json` — the `test:py` script.
- `.claude/skills/bmad-ship-story/SKILL.md` — the "Tested =" line in both places, and the Python fact.
- `README.md` — `agent/` in the Layout block.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

| Date | Change |
| --- | --- |
| 2026-08-10 | Story created |
| 2026-08-10 | Tasks 1-4 implemented test-first; pytest registered in the local gate |
| 2026-08-10 | Local round: 4 Argus runs + 1 CodeRabbit CLI round, 6 findings, all applied |
| 2026-08-10 | MR !39 rounds 1-3: 15 findings applied; round 4 clean; status done |
