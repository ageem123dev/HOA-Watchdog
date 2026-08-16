---
baseline_commit: 0f079cc
---

# Story 4.8: Told before you pay

Status: ready-for-dev

## Why this story exists

FR-8 asks for **two** channels, and only one of them exists:

> *"Surfaces high-priority alerts in a dedicated 'Watchdog Alerts' widget on the main web dashboard.
> Dispatches a structured, automated email alert summarising the anomaly to configured board
> members."*

Story 4.5 built the widget. The second sentence has never been implemented, and the gap is not
cosmetic — it is the difference between a product that *answers* and a product that *warns*. The
epic's own name for this story says which one is being bought: **told before you pay**. A duplicate
invoice found on a dashboard nobody opened until the following Tuesday was found after the cheque
went out, and the association is out the money either way.

Everything the email needs is already built and was deliberately left waiting for it:

- `core/findings/finding-view.ts` names this story in its header — *"three surfaces will describe
  the same finding … the alert email is 4.8 — and 4.8 sends its text to people who will read it
  beside the page."*
- `core/ports/finding.ts` carries `RaisedFinding.wasAlreadyKnown` and says in as many words that it
  is *"the field story 4.8 needs and cannot work out for itself"*.
- `core/detection/detection-run.ts` protects its evidence key names because *"stories 4.5 and 4.8
  read [them] back"*.
- `app/findings/[id]/page.tsx` is the destination. EXPERIENCE.md requires the already-reviewed state
  *"reached from an old email link"*, which story 4.6 shipped — the link's landing pad has existed
  for two stories with nothing pointing at it.

This story is the last one in Epic 4, and it is the one that closes FR-8.

### Three decisions, taken 2026-08-16

**1. The email is plain text. There is no HTML part.**

AD-8 binds FR-8 directly: *"Extracted values are data, never instructions … the renderer escapes on
output."* A vendor name lifted off a scanned invoice is about to be placed in a document sent to a
human's inbox, and the cheapest way to keep it data is to send a document that has no markup for it
to become. Two further reasons, neither of them the security one:

- A multipart message needs two templates saying the same thing, and this codebase has spent four
  stories arguing that two wordings of one finding is a board packet that contradicts itself.
- The reader is a volunteer director on a phone. A structured plain-text alert renders identically
  in every client, forever, and cannot be broken by a dark-mode stylesheet.

The cost is honest: no logo, no button. UX-DR23 asks for *"plain language inside formal structure"*,
and plain text is that structure at its most literal.

**2. The transport is an HTTP mail API called with `fetch`, behind a port.**

SMTP would mean `nodemailer` — a dependency, a connection pool, and TLS configuration. Story 4.7
took the same tie the same way, choosing CSV over a PDF library, and the precedent for an outbound
HTTP integration is already written: `adapters/agent/chat-client.ts` is a hand-rolled `fetch` client
with named env vars, a bounded timeout, and a refusal that is never an empty success. This adapter
is that shape again.

**The endpoint is configuration, not code.** `MAIL_API_URL` is read rather than compiled in, so the
provider is a value in `.env.local` and swapping it is not a code change. The adapter is written
against the JSON body shape Resend and Postmark both accept (`from`, `to`, `subject`, `text`);
naming a provider in `core/` would be the mistake, and naming none in the *adapter* would mean
shipping something that cannot send.

*This is the one decision in this story a reviewer may reasonably want to overrule.* It is recorded
here rather than buried so that overruling it costs one adapter file.

**3. Delivery is recorded in the database, and that record is what makes AD-13 true.**

AD-13 says the system *"never emits a second alert for a finding already raised"*. Today nothing
records that an alert was emitted, so that sentence is a property of code that has not been written
yet. A `finding_alert` table with a unique constraint on `finding_id` makes it a property of the
database — the arrangement migration 021 uses for the finding itself, and the arrangement this
project reaches for every time a rule matters more than a habit.

It also earns its place twice over: the register answers *"what did the board know, and when"*, and
**when they were told** is part of that answer. A row here is evidence that a director was notified
on a date, which is exactly the kind of claim a fiduciary record exists to support.

## Story

As a board member,
I want an email the moment the system notices something wrong with a payment,
so that I find out before the cheque goes out rather than the next time I happen to open the
dashboard.

## Acceptance Criteria

**AC1 — A finding raised for the first time sends one email; raising it again sends none.**
AD-13's rule, at the inbox rather than in the table. Re-uploading the same bank statement re-runs
detection, and every detector amends rather than appends — but an amend that mailed would deliver
the same warning a second time, and the no-op would hold in the database while failing in the only
place a board member can observe it. The guarantee is enforced by the unique constraint on
`finding_alert.finding_id`, not by a code path that remembers to check.

**AC2 — The recipients are every board member who is not disabled, and nobody else.**
Decided in `epics.md` on 2026-08-12: *"the recipient list is every `board_member` row that is **not
disabled** — a director who has left the board keeps their audit trail and stops receiving mail, the
same rule sign-in already applies."* No recipient model, no per-member preferences, no severity
routing, and **no unsubscribe**. A disabled member's absence must be asserted directly: a test in
which the only difference between two runs is `disabled_at` and the only difference in the outcome
is that address.

**AC3 — An extracted value cannot become part of the message's structure.**
AD-8. A vendor name arrives from a document the association received and is placed in a subject
line and a body. Both are forgeable if the value is passed through untouched: a `\r\n` in a subject
is a header, and a subject is where header injection actually lands. Every value interpolated into
the message is stripped of CR, LF and other control characters and length-capped before it is used,
and the subject is asserted to be a single line whatever it was built from. There is no markup, so
there is nothing to escape into — see the decision above — and that is the argument, not an excuse
to skip the control-character rule.

**AC4 — The email links to the finding, absolutely, and the link works from a phone.**
EXPERIENCE.md: *"Phone priority surfaces: Finding detail and its evidence, reached from an FR-8
alert email."* A relative path is meaningless in an inbox, so the link is built from
`WATCHDOG_BASE_URL` and `findingRoute(id)` — **`findingRoute` is reused, never re-spelled**, because
a second spelling of the detail path is a dead link discovered by the person the alert was for. The
route is not public (`core/auth/route-policy.ts` deliberately omits it), so an unauthenticated click
lands on sign-in and returns to the finding afterwards; that is the existing behaviour and this
story asserts it rather than changing it.

**AC5 — The email says what was compared and never claims more than that.**
UX-DR23: *"Never imply certainty the system lacks."* The subject and the opening sentence come from
`toFindingRow`, which already decides the title and the evidence sentence for the dashboard and the
detail page. **Reuse it.** A fourth wording of "possible duplicate" written for the email is the
drift that reuse exists to prevent, and it would be the one wording read aloud in a dispute. Where
the email needs more than the row has, it takes it from `toFindingDetail` — not from a new reading
of the evidence.

**AC6 — The email never claims an action the architecture forbids.**
UX-DR23 again, and NFR-2 underneath it. The system holds no payment credential and can stop nothing.
The message may say what was noticed and where to look; it may not say the payment was blocked, held,
cancelled or flagged to anyone, and it may not offer to do any of those. Assert the absence of that
vocabulary in the rendered message, not only the presence of the right sentence — a test that checks
what the copy says passes against copy that also says something false.

**AC7 — A delivery is recorded, with who it went to and when.**
One row per finding, carrying the moment it was sent and the addresses it went to. `delete` and
`truncate` are revoked as they are on `finding`, for the same reason: a record of what the board was
told is worth nothing if it can be emptied. `watchdog_reader` gets no grant, matching migration
021's deliberate silence — a catalog entry that could read this table would let a question about
dues disclose which directors were warned about whom.

**AC8 — A mail failure must not fail the upload, and must not be silent.**
`core/ingestion/run-detection.ts` already argues this exactly: the document *was* read, its records
*are* stored, and throwing here would report a success as a failure while the caller's retry changed
nothing. So the send is guarded, reported through `onError`, and swallowed — and the delivery row is
left unsent so a later run can pick it up, rather than marked sent so nothing ever will. **The
guarantee is at-least-once, never exactly-once, and the story says so** rather than leaving a reader
to assume the stronger one.

**AC9 — Not configured means not sending, and says which name is missing.**
The pilot runs without mail credentials today and must keep building and testing without them —
`next build` evaluates modules, so a module-scope read that throws makes the build require real
secrets (`adapters/auth/env.ts` records that lesson). Absent configuration is a clean, named refusal
before anything is claimed or sent: no crash, no half-send, and **no delivery row**. Names only in
the error, never values, because `MAIL_API_KEY` is a credential and a configuration error is the
message most likely to be pasted into an issue.

**AC10 — No model is anywhere in this path, and an unknown finding type degrades rather than throws.**
Epic 4's standalone claim depends on it: *"SQL detects, templated prose describes, no model in
FR-6/7/8."* Assert it structurally — nothing in the mail path may reach the extraction or reasoning
credential, the way `core/security/dual-llm-boundary.ts` asserts its own boundary. And because
`evidence` is `jsonb` written by whichever detector version ran, a finding type this code does not
recognise produces a plainer email rather than an exception: the failure of a mailer that throws is
not the one bad message, it is the nineteen good ones behind it in the loop.

## Tasks / Subtasks

- [x] **Task 1 — The delivery record** (AC: 1, 7)
  - [x] `migrations/023_finding_alert.sql`. One row per finding, `finding_id` unique and referencing
        `finding (id)`. Carry `claimed_at` (defaulted), `sent_at` (nullable — null *is* the
        unsent state), `recipients` and a nullable `failure`. Revoke `delete, truncate` from
        `watchdog_writer` and from `public`; grant `watchdog_reader` nothing, and say in a comment
        that the silence is the decision.
  - [x] Read migration 021 first and copy its habits, not just its shape: a comment saying **why**
        each constraint exists, and a `comment on table`/`comment on column` for anything a later
        reader would otherwise have to guess at.
  - [x] `migrations/finding-alert.test.ts`, in the family style — the unique constraint refuses a
        second row, the revokes actually bite (assert the `42501`, do not assume it), and the
        foreign key holds.

- [ ] **Task 2 — The ports** (AC: 1, 2, 7, 8)
  - [ ] `core/ports/mail.ts` — a `MailSender` with one method taking a message
        (`to`, `subject`, `text`). Nothing about providers, nothing about HTML. Write the header
        argument for why this port is thin, the way `core/ports/finding.ts` argues for what it omits.
  - [ ] `core/ports/finding-alert.ts` — claim, and record the outcome. **The claim is one statement,
        not a read followed by a write**: `insert … on conflict (finding_id) do update … returning`,
        so two runs arriving together produce one claim and the loser is told it lost. This is the
        same argument `RaisedFinding.wasAlreadyKnown` makes and it must not be re-litigated in
        application code.
  - [ ] Extend the board-member read with "every member who is not disabled". Decide whether that
        belongs on `UserDirectory` (today: sign-in only) or on a new port, and **write the reason
        down** — `core/ports/finding.ts`'s "two ports, because these are two capabilities" is the
        precedent and it argues for the split.
  - [ ] Port shape asserted with `declaredMembers` (`core/ports/declared-members.ts`) — the shared
        helper, not one of the five copies with the `indexOf` bug.

- [ ] **Task 3 — The message a board member reads** (AC: 3, 4, 5, 6, 10)
  - [ ] `core/findings/alert-email.ts`. Builds subject and body from `toFindingRow` /
        `toFindingDetail` plus the absolute link. **Import them; do not re-read `evidence`.**
  - [ ] The control-character strip and the length cap are one function, used on every interpolated
        value, and tested on the subject specifically. Look at `core/csv/cell.ts` before writing it:
        that module solved the sibling problem (a value that becomes a formula) and its structure —
        one narrow neutraliser, heavily commented, reused everywhere — is what this should look like.
        **Do not extend `cell.ts` itself**; a CSV formula guard and a header-injection guard are
        different rules and merging them makes both harder to reason about.
  - [ ] Assert the forbidden vocabulary of AC6 as a negative over the rendered text.
  - [ ] An unrecognised `finding_type` yields a message that still names the finding and still links
        to it. Test it with a type no detector produces.

- [ ] **Task 4 — The adapter and its configuration** (AC: 4, 9)
  - [ ] `adapters/mail/mail-sender-http.ts`. Read `adapters/agent/chat-client.ts` first and follow
        it: names as module constants, config read at call time, a bounded timeout via
        `AbortSignal.timeout`, a non-2xx treated as a failure and never as an empty success, and an
        error that carries names and never values.
  - [ ] `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_FROM`, `WATCHDOG_BASE_URL` in `.env.example`, with the
        commentary that file carries — what each is for, and what happens when it is unset.
        `.env.example` is read by `core/security/nfr2-guard.test.ts` on every run; check the new
        names against `core/security/forbidden-credentials.ts` rather than assuming they are clear.
  - [ ] `WATCHDOG_BASE_URL` is validated as an absolute `http(s)` origin at read time. A base URL
        that is a path produces links that work in development and are broken in every inbox.
  - [ ] Unit-test the adapter against a stub `fetch`. Assert the request body and the header,
        assert the key never appears in a thrown error, and assert the timeout is armed — a
        `requestTimeout` that only logs is the shape this project has already shipped once.

- [ ] **Task 5 — The wiring** (AC: 1, 8, 9)
  - [ ] `core/ingestion/notify-findings.ts`, called from `extract-document.ts` **after**
        `runDetection` and inside the same fail-soft discipline. Read `run-detection.ts`'s header in
        full before writing this — it has already made every decision this file faces (absent
        collaborators mean do nothing; one failure must not stop the rest; reporting the failure
        must not become the failure), and the reasons are written out.
  - [ ] A wiring test in the shape of `core/ingestion/detection-wiring.test.ts`. That file exists
        because a step that is silently never called *fails nothing* — which is precisely the risk
        for a mailer nobody is watching.
  - [ ] Order and claim semantics: oldest unnotified finding first, bounded limit, and a stale claim
        (`sent_at is null` and `claimed_at` older than the retry window) is re-claimable. State the
        window as a named constant with the reasoning beside it.

- [ ] **Task 6 — Close FR-8 honestly** (AC: all)
  - [ ] Run the AC audit: for each AC, name the test that would fail if the behaviour were removed.
        It has found something on nine consecutive stories.
  - [ ] Confirm FR-8's *first* channel — the dashboard widget from story 4.5 — is present and
        reachable. This story does not rebuild it and must not; it does have to be able to say
        truthfully that both channels now exist.
  - [ ] `docs/as-built.md` gains the mail path: what is sent, to whom, what is recorded, and the
        at-least-once caveat from AC8. A director asking "why did I get this" needs somewhere to
        look that is not the source.

## Dev Notes

### What already exists and must not be rebuilt

| Thing | Where | Note |
| --- | --- | --- |
| Row copy, severity, title, evidence sentence | `core/findings/finding-view.ts` | `toFindingRow`. Its header names this story. Reuse — this is the fourth surface. |
| The longer form, figures, comparison tables | `core/findings/detail-view.ts` | `toFindingDetail`, for anything the row does not carry. |
| The detail path | `core/auth/route-policy.ts` | `findingRoute(id)`. Never spell it a second time. |
| `wasAlreadyKnown` | `core/ports/finding.ts` | Returned rather than discovered by a `select`, and the header says why. |
| Fail-soft bookkeeping after ingestion | `core/ingestion/run-detection.ts` | Every decision this story's wiring faces, already argued. |
| Outbound HTTP with env config and a bounded timeout | `adapters/agent/chat-client.ts` | The template for the mail adapter. |
| Config read at call time, `MissingAuthConfigError` | `adapters/auth/env.ts` | Why a module-scope read would break `next build`. |
| Value neutralisation, one narrow module | `core/csv/cell.ts` | The shape to copy. **Not** the module to extend. |
| Shared port-shape assertion | `core/ports/declared-members.ts` | The fixed one. Five older copies carry an `indexOf` bug. |
| Credential-name guard, `.env.example` parsing | `core/security/nfr2-guard.test.ts`, `forbidden-credentials.ts` | Check new variable names against it before adding them. |

### `wasAlreadyKnown` is not this story's trigger, and that needs saying

`core/ports/finding.ts` predicts that it will be. It is the better field for the job it was written
for — telling a detector's caller what its own write did — but it cannot survive a failed send: a
process that raises a finding, learns `wasAlreadyKnown: false`, and then fails to deliver has lost
the only signal that the email is owed. The next run sees `true` and the warning is never sent.

So the trigger is the **absence of a delivery row**, which is durable, and `wasAlreadyKnown` remains
correct and unused by this path. Do not delete it and do not rewrite its header; note the divergence
where a later reader will find it.

### The failure that costs money

Every other story in this epic fails visibly — a wrong number on a page somebody is looking at. This
one fails **silently and in the direction of doing nothing**: an alert that is never sent looks
exactly like a month with no findings. The dashboard still shows the finding, so nothing is broken
enough to notice.

That is why AC8 insists the failure is reported and the row is left unsent, and why Task 5's wiring
test exists. When choosing between "swallow it" and "make it loud", this story's default is loud —
the opposite of the default `run-detection.ts` chose, because a missed detection is recovered by the
next upload and a missed alert is not recovered by anything.

### What 4.7 learned, and this story inherits

- **The AC audit has found something on nine consecutive stories.** On 4.7 it found a repeated URL
  parameter read two ways by the page and its export. Run it against the ACs, not against the code.
- **A fix is the highest-risk diff.** Round 2 of MR !61 pinned a deadline rather than substituting
  it, and that was a fix to a fix.
- **Ask of every refusal test: what would this look like if the refusal did not happen?** AC6 and
  AC9 are both refusal tests, and AC6's is a *negative over copy*, which is the easiest kind to
  write vacuously.
- **The test-value pass finds what mutation cannot.** A test whose premise has expired fails loudly
  when you break the code and looks healthy.
- **Anything carrying a backslash goes through the editing tool, never a shell heredoc.** A `\r\n`
  written through a heredoc becomes literal bytes, and this story is *full* of `\r\n` — AC3 is
  about exactly that sequence. `docs/no-control-characters.test.ts` reads markdown only and would
  not see it in a `.ts` file. This is the third recurrence; widening that guard is an open action
  item this story may pick up, and this is the story most likely to need it.
- **Never truncate a gate's output past its verdict.**
- **A clean CodeRabbit verdict arrives as an edit to the summary comment**, not a new note.
- **The close-out rides in every review round's commit**, not the last one.

### Where this story is unlike its predecessors

It is the first thing this system **sends**. Every surface so far waits to be visited; this one
arrives uninvited in a volunteer's inbox, and it cannot be corrected after the fact — there is no
edit, no recall, and the recipient is the person the product exists to serve. That asymmetry is the
argument for plain text, for reusing copy that four surfaces already agree on, and for AC6's
negative assertion. A page that says something wrong is fixed by a deploy. An email that says
something wrong has already been read.

### References

- [Source: epics.md] — Epic 4 spine row 4.8; the two decisions of 2026-08-12 (recipients,
  thresholds); *"Two places the voice will fight the code"*
- [Source: docs/prd/prd.md#FR-8] — the two channels, stated as testable consequences
- [Source: ARCHITECTURE-SPINE.md#AD-8] — extracted values are data; `FR-8 → adapters/mail, app/`
- [Source: ARCHITECTURE-SPINE.md#AD-13] — never a second alert for a finding already raised
- [Source: EXPERIENCE.md] — Voice and Tone (the glossary mapping: FR-8 builds the *finding*
  surface); Information Architecture (finding detail entered from an email link); Responsive &
  Platform (phone priority surfaces); Alert Lifecycle
- [Source: migrations/021_finding.sql] — the table this one references, and the commenting standard
- [Source: 4-7-the-register-the-board-hands-an-auditor.md] — the review record these learnings come
  from

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m]

### Debug Log References

### Test Design

#### Task 1 — the delivery record

**Behaviour: migration 023 creates `finding_alert` and holds it to the rules AD-13 needs.**

*If it ran correctly, how would I know?* A second alert row for the same finding is **refused by the
database** — not merely never written by the application. A sent row can be read back naming who it
went to and when. `watchdog_writer` can insert and update but cannot delete or truncate, and
`watchdog_reader` cannot see the table at all.

*How am I going to test it?* Two ways, and both are needed. The migration **text** is asserted with
`executable()` so the revokes and the absent grant are checked without a database — those run in
`npm test` on every push. The **behaviour** is asserted against the real database in
`npm run test:db`, because a revoke that does not bite looks identical to one that does until
something tries.

*Could this happen anywhere else?* Migration 021 is the sibling and it made every one of these
decisions first. Its defects are documented: a grant taken back by default privileges rather than
never given, a lifecycle enforceable only by the application until a trigger was written, and a
one-way rule that an INSERT walked straight past because the trigger fired on UPDATE alone.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | a second alert row for one finding is accepted | GUARD | unique on `finding_id`; assert `23505` |
| 2 | `watchdog_writer` can DELETE or TRUNCATE the record of what the board was told | GUARD | revokes; assert `42501` against a real row |
| 3 | `watchdog_reader` can SELECT it, so a catalog entry could disclose who was warned | GUARD | no grant; assert `42501` |
| 4 | an alert references a finding that does not exist | GUARD | foreign key; assert `23503` |
| 5 | a row claims to be sent while naming nobody it was sent to | GUARD | check constraint, mirroring `finding_review_is_attributed`; assert `23514` |
| 6 | a row names recipients while claiming never to have been sent | GUARD | the same constraint, from the other side |
| 7 | `recipients` is a scalar or an object masquerading as a list | GUARD | `text[]`, and a check that it is non-empty when sent |
| 8 | a sent alert is quietly un-sent, so the record says a warning was never delivered | GUARD | trigger refusing `sent_at` non-null → null; assert `P0001` |
| 9 | an alert is inserted already sent, bypassing the claim | GUARD | the same trigger on INSERT — 021 shipped this hole and had to fix it |
| 10 | `failure` grows without bound from a provider echoing the request back | GUARD | length cap; assert `23514` |
| 11 | UPDATE is revoked along with DELETE, making claim→sent unimplementable | GUARD-by-text | assert no `revoke … update … on finding_alert`; 021's sibling assertion |
| 12 | the migration is applied twice | OUT-OF-SCOPE | `scripts/migrate.mjs` records applied migrations and skips them; not this file's contract |

**Cross-check.** #5 and #6 are one property from both sides, and it is the strong one: the sent state
and its recipients cannot disagree, which is the shape `finding_review_is_attributed` already proved
worth having. #8 and #9 are the same about the lifecycle — 021's trigger had to be widened from
UPDATE-only to both ends after a plain INSERT walked past it, and copying the fixed version rather
than the original is the whole value of having a sibling.

### Completion Notes List

**Task 1 — the delivery record.** `migrations/023_finding_alert.sql` and its 22-test suite.
AD-13's "never a second alert" is now a unique constraint rather than a habit the mailer has to
keep. The row carries both moments of an unrollbackable send — `claimed_at` and `sent_at` — because
an email cannot be un-sent and a database write cannot be un-written, so the two can only be
ordered, and the guarantee that buys is **at-least-once, stated rather than assumed**.

*Guarded:* a second alert per finding (unique); an alert on a finding that does not exist (FK); a
row claiming to be sent while naming nobody, an empty list, a list with a NULL in it, and a list
with a blank string in it (one immutable function, because a CHECK may hold neither a subquery nor
`unnest`, which was measured rather than assumed); an oversized `failure`; un-sending, re-claiming
or re-addressing a delivered alert, and an alert inserted already sent; DELETE and TRUNCATE for
`watchdog_writer` and `public`; any sight of the table for `watchdog_reader`.

*Deliberately left mutable:* `claimed_at` and `failure` on an **unsent** row. The at-least-once
guarantee depends on a stale claim being re-claimable, and a trigger that froze the row entirely
would satisfy every refusal above and strand every failed send.

*Out of scope:* double application of the migration — `scripts/migrate.mjs` records what it has
applied, and that is its contract rather than this file's.

*Sensitivity check:* two, both against the live schema, because a migration that is already applied
cannot be broken by editing its file. Dropping `finding_alert_one_per_finding` failed exactly one
test; narrowing the trigger to `before update` — migration 021's documented original hole — failed
exactly the test written for it. Both restored and re-run green.

*Adversarial review (Argus, `auto`/`gemini-3.1-pro-high`, confidence 0.95, 4/4 files, 1 call, 102k
tokens, audit chain OK):* five findings, all verified against the real files.
- **confirmed (high)** — `noUncheckedIndexedAccess` makes every `rows[0].x` a build error. `tsc`
  reported 7 in this file. Fixed with the `rows[0]!` idiom `migrations/finding.test.ts` already uses.
- **confirmed (high)** — the teardown assumed every client connected. A `beforeAll` failing after
  the first `connect()` would throw inside `finally` while building the `allSettled` array and leak
  the connection the `finally` exists to close. Fixed by mapping over the clients with `?.end()`.
- **not-reproduced (medium)** — "used-before-assigned errors in closure scopes". TypeScript does not
  perform definite-assignment analysis across closures, and `tsc` reported none. The sibling suites
  declare the same way.
- **confirmed (low)** — the trigger guarded `sent_at` and `recipients` while the prose beside it
  claimed `claimed_at` and `failure` were mutable only *while unsent*. The prose was right and the
  trigger was not; tightened to `new is distinct from old`, which also covers whatever a later
  migration adds. Driven by two new tests that failed against the old trigger first.
- **partly confirmed (info)** — Argus read `AC8` as a wrong ticket reference. The referent was real
  but the citation broke the project's rule against story references in source comments; both
  occurrences now state the property instead of pointing at the story.

*Repo guard caught one thing nothing else would have:* `docs/readme.test.ts` counts the migrations,
so adding one turned the README's "22 SQL migrations" into a lie and failed the suite. Updated.


### File List

| File | Change |
| --- | --- |
| `migrations/023_finding_alert.sql` | new — the delivery record, its constraints, its lifecycle trigger and its grants |
| `migrations/finding-alert.test.ts` | new — 22 tests: 4 over the migration text, 18 against the database |
| `README.md` | modified — the migration count the repo guard checks |


### Review Findings

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-16 | Story created. |
