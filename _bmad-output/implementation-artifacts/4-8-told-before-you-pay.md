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

- [x] **Task 2 — The ports** (AC: 1, 2, 7, 8)
  - [x] `core/ports/mail.ts` — a `MailSender` with one method taking a message
        (`to`, `subject`, `text`). Nothing about providers, nothing about HTML. Write the header
        argument for why this port is thin, the way `core/ports/finding.ts` argues for what it omits.
  - [x] `core/ports/finding-alert.ts` — claim, and record the outcome. **The claim is one statement,
        not a read followed by a write**: `insert … on conflict (finding_id) do update … returning`,
        so two runs arriving together produce one claim and the loser is told it lost. This is the
        same argument `RaisedFinding.wasAlreadyKnown` makes and it must not be re-litigated in
        application code.
  - [x] Extend the board-member read with "every member who is not disabled". Decide whether that
        belongs on `UserDirectory` (today: sign-in only) or on a new port, and **write the reason
        down** — `core/ports/finding.ts`'s "two ports, because these are two capabilities" is the
        precedent and it argues for the split.
  - [x] Port shape asserted with `declaredMembers` (`core/ports/declared-members.ts`) — the shared
        helper, not one of the five copies with the `indexOf` bug.

- [x] **Task 3 — The message a board member reads** (AC: 3, 4, 5, 6, 10)
  - [x] `core/findings/alert-email.ts`. Builds subject and body from `toFindingRow` /
        `toFindingDetail` plus the absolute link. **Import them; do not re-read `evidence`.**
  - [x] The control-character strip and the length cap are one function, used on every interpolated
        value, and tested on the subject specifically. Look at `core/csv/cell.ts` before writing it:
        that module solved the sibling problem (a value that becomes a formula) and its structure —
        one narrow neutraliser, heavily commented, reused everywhere — is what this should look like.
        **Do not extend `cell.ts` itself**; a CSV formula guard and a header-injection guard are
        different rules and merging them makes both harder to reason about.
  - [x] Assert the forbidden vocabulary of AC6 as a negative over the rendered text.
  - [x] An unrecognised `finding_type` yields a message that still names the finding and still links
        to it. Test it with a type no detector produces.

- [x] **Task 4 — The adapter and its configuration** (AC: 4, 9)
  - [x] `adapters/mail/mail-sender-http.ts`. Read `adapters/agent/chat-client.ts` first and follow
        it: names as module constants, config read at call time, a bounded timeout via
        `AbortSignal.timeout`, a non-2xx treated as a failure and never as an empty success, and an
        error that carries names and never values.
  - [x] `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_FROM`, `WATCHDOG_BASE_URL` in `.env.example`, with the
        commentary that file carries — what each is for, and what happens when it is unset.
        `.env.example` is read by `core/security/nfr2-guard.test.ts` on every run; check the new
        names against `core/security/forbidden-credentials.ts` rather than assuming they are clear.
  - [x] `WATCHDOG_BASE_URL` is validated as an absolute `http(s)` origin at read time. A base URL
        that is a path produces links that work in development and are broken in every inbox.
  - [x] Unit-test the adapter against a stub `fetch`. Assert the request body and the header,
        assert the key never appears in a thrown error, and assert the timeout is armed — a
        `requestTimeout` that only logs is the shape this project has already shipped once.

- [x] **Task 5 — The wiring** (AC: 1, 8, 9)
  - [x] `core/ingestion/notify-findings.ts`, called from `extract-document.ts` **after**
        `runDetection` and inside the same fail-soft discipline. Read `run-detection.ts`'s header in
        full before writing this — it has already made every decision this file faces (absent
        collaborators mean do nothing; one failure must not stop the rest; reporting the failure
        must not become the failure), and the reasons are written out.
  - [x] A wiring test in the shape of `core/ingestion/detection-wiring.test.ts`. That file exists
        because a step that is silently never called *fails nothing* — which is precisely the risk
        for a mailer nobody is watching.
  - [x] Order and claim semantics: oldest unnotified finding first, bounded limit, and a stale claim
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

#### Task 2 — the ports

**Behaviour: three port declarations, and what each one refuses to let a caller do.**

*If it ran correctly, how would I know?* The shapes compile against the adapters and the notifier, and
the **absence** of the capabilities each port argues against is asserted rather than described.
`declaredMembers` is what makes an absence testable: it returns every member line, so a write
capability cannot arrive on a read port in a syntax an exhaustive assertion overlooks.

*How am I going to test it?* Source assertions with `declaredMembers` (the shared helper, not the
five older copies). No runtime behaviour is being tested here — these are declarations — so a test
that instantiated a fake would be asserting the fake.

*What else can go wrong?* The interesting failures are all shape failures, and each one is a
capability arriving somewhere it lets a later refactor do something the architecture forbids.

*Could this happen anywhere else?* `finding.ts` split raising from reviewing so a detector could not
sign off its own work, and `finding-reader.ts` split reading from both. This is the third application
of one argument.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | `MailSender` grows a read — a mailbox the gateway can poll | GUARD | exact member list; one method |
| 2 | `MailMessage` admits a single `to` string, so a caller can send to one director and believe it sent to the board | GUARD | `readonly to: readonly string[]` asserted exactly |
| 3 | `MailMessage` grows an `html` field, re-opening the markup decision by accident | GUARD | exact member list — the decision is enforced by the type, not by a habit |
| 4 | the recipient read lands on `UserDirectory`, letting sign-in enumerate every address | GUARD | separate port; `UserDirectory`'s member list asserted unchanged |
| 5 | the recipient read takes a `limit`, so a director is silently dropped from a warning | GUARD | no `limit` in the declared member, and the reason recorded |
| 6 | the ledger grows a `delete`, `unsend` or `clear` | GUARD | exact member list; migration 023 refuses it anyway, so a method here would be one the database answers with `42501` |
| 7 | `claim` returns `void`, so a caller cannot tell "I own this" from "somebody else does" | GUARD | return type asserted as `Promise<boolean>` |
| 8 | `claim` takes no staleness argument and reads the clock itself | GUARD | `staleBefore: Date` in the declared member — the seam the retry test needs |
| 9 | reading what needs alerting lands on the ledger, so one object can both choose and claim | GUARD | it goes on `FindingReader`, whose port test asserts an exact list |
| 10 | `awaitingAlert` is unbounded | GUARD | `limit: number`, required, the rule `unreviewed` and `register` already carry |

**Cross-check.** #6 is checked twice by two independent mechanisms — the port declares no way to say
it, and migration 023 revokes the grant that would let it happen. Either alone is a convention;
together they are a property, which is the arrangement migration 007's comment argues for.

#### Task 3 — the message a board member reads

**Behaviour A: `oneLine(value, cap)` — every extracted value, made unable to carry structure.**

*If it ran correctly, how would I know?* Whatever goes in, what comes out is a single line, no longer
than the cap, and non-empty only if the input held something. The strong check is the **property**:
for arbitrary input the result contains no character that any mail agent treats as a line break.

*How am I going to test it?* Pure function, no seams needed. Property-style assertions over a table
of hostile inputs, plus the ordinary case.

*What else can go wrong?* This is the AD-8 boundary, so the failure modes are the injection surface
itself — and the interesting ones are the spellings of "newline" that are not `
`.

*Could this happen anywhere else?* `core/csv/cell.ts` is the sibling: the same problem — a value from
a document becoming syntax — in a different output format. Its structure is what this copies. It is
deliberately **not** extended: a formula guard and a header-injection guard are different rules, and
merging them makes both harder to reason about.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | `
` in a vendor name forges a mail header | GUARD | the canonical injection; assert one line out |
| 2 | a bare `` or bare `
` does the same | GUARD | both alone — agents differ on which they honour |
| 3 | ` ` / ` ` are line breaks to some parsers and invisible here | GUARD | asserted by code point, not by eyeballing |
| 4 | other C0 controls, `DEL`, and C1 (`` is NEL, a line break) | GUARD | a table of code points |
| 5 | a tab shifts the label/value layout | GUARD | collapsed to a space |
| 6 | leading or trailing whitespace makes a value look absent or misaligned | GUARD | trimmed |
| 7 | a value that is only whitespace becomes `''` and the caller renders an empty label | GUARD | returns `''`, and the caller is asserted to drop the line |
| 8 | an oversized value pushes a subject past what an agent will show | GUARD | cap, with the truncation visible |
| 9 | the cap splits a surrogate pair and produces a lone surrogate | GUARD | an astral character at the boundary; the result must still be valid |
| 10 | stripping is done with a regex that eats the character *after* the control | GUARD | a value where the control sits mid-word |

**Behaviour B: `toAlertEmail(finding, baseUrl)` — the message itself.**

*If it ran correctly, how would I know?* A subject naming the finding, a body carrying the sentence
the dashboard shows for it, the figures the detector recorded, and an absolute link that resolves to
that finding's page. Nothing in it claims the system did anything.

*How am I going to test it?* Pure function over a `FindingDetail`. The link is checked by
construction against `findingRoute`, never against a literal path — a second spelling of the detail
route is the dead link this story would be discovered by.

*What else can go wrong?* Everything that makes the email disagree with the page, plus everything
that makes it claim more than the system knows.

*Could this happen anywhere else?* The dashboard row and the detail page are the two surfaces that
already describe a finding. This is the third, and the whole arrangement of `finding-view.ts` exists
so it cannot say something different.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 11 | the email writes its own title and drifts from the page | GUARD | asserted equal to `toFindingRow`'s, not to a literal |
| 12 | the email writes its own sentence | GUARD | asserted equal to `toFindingDetail`'s `summary`, verbatim |
| 13 | the link is relative, so it is meaningless in an inbox | GUARD | absolute, and parses as a URL |
| 14 | the link is a second spelling of the detail path | GUARD | built from `findingRoute`; asserted against it |
| 15 | a base URL with a trailing slash produces `//findings/…` | GUARD | both spellings give one URL |
| 16 | the subject carries a newline from a vendor name | GUARD | behaviour A, applied to the composed subject |
| 17 | the message claims the payment was blocked, held, stopped, cancelled or flagged | GUARD | a negative over the whole rendered text — the system holds no payment credential and can stop nothing |
| 18 | the message says "duplicate" rather than "possible duplicate" | GUARD | UX-DR23; asserted through the reused title rather than re-checked here |
| 19 | an unrecognised `finding_type` throws, so nineteen good messages behind it never send | GUARD | a type no detector produces; still names and links the finding |
| 20 | evidence of the wrong shape throws | GUARD | `jsonb` written by whichever detector version ran; the view layer already degrades and this must not undo that |
| 21 | a figure with no value renders as `0` or `undefined` | GUARD | absent stays absent — the rule `detail-view.ts` already states |
| 22 | the body says nothing about why this arrived, so a director cannot tell it is not spam | GUARD | asserted present; there is no unsubscribe, so this line is the whole of the explanation |
| 23 | the message reads as reviewed when it is not, or vice versa | OUT-OF-SCOPE | an alert is only ever sent for an unalerted finding, which is unreviewed by construction; the trigger in 021 refuses a finding raised already reviewed |

**Cross-check.** #11 and #12 are the strong ones and they are cross-checks by construction: the
assertion is against what the *other two surfaces* produce for the same finding, not against a
literal this test chose. A wording change that is legitimate updates all three together; one that is
drift fails here.

#### Task 4 — the adapter and its configuration

**Behaviour A: `readMailConfig(env)` and `readBaseUrl(env)` — configuration, read at call time.**

*If it ran correctly, how would I know?* Complete configuration yields the three values; incomplete
configuration throws an error **naming the variables** and carrying none of their values.

*How am I going to test it?* `env` is a parameter with a `process.env` default, the shape
`adapters/auth/env.ts` established and for the reason it records: Next.js evaluates modules during
`next build`, so a module-scope read that throws makes the build itself require real credentials.

*What else can go wrong?* Every way a value can be present and useless.

*Could this happen anywhere else?* `adapters/agent/chat-client.ts` reads two variables the same way
and validates its base URL the same way. This is the third reader of that pattern.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | a variable is absent | GUARD | named in `missing`; the message carries no value |
| 2 | a variable is present but blank or only whitespace | GUARD | same as absent — a blank credential is not one |
| 3 | the error message quotes the API key | GUARD | the key is a distinctive string; asserted absent from the thrown message |
| 4 | `MAIL_API_URL` is not a URL at all | GUARD | named as missing rather than reaching `fetch` |
| 5 | `MAIL_API_URL` is a path, so it resolves against nothing | GUARD | absolute required |
| 6 | `WATCHDOG_BASE_URL` is a path — links work in development and are dead in every inbox | GUARD | absolute `http`/`https` required |
| 7 | `WATCHDOG_BASE_URL` has a trailing slash | GUARD | one link either way — asserted in Task 3, and here at the reader |
| 8 | config is read at module scope, so `next build` needs real secrets | GUARD-by-shape | `env` is a parameter; the build gate passing is the standing proof |
| 9 | `MAIL_API_URL` is `http:` on a public host | OUT-OF-SCOPE | the pilot may run a local relay; `WATCHDOG_BASE_URL` is the one a board member's browser follows and it accepts both for the same reason |

**Behaviour B: `createHttpMailSender()` — the send.**

*If it ran correctly, how would I know?* One POST, carrying the sender, the recipients, the subject
and the text as JSON, with the key in an `Authorization` header and nowhere else. It resolves only on
a response that says the whole list was accepted.

*How am I going to test it?* `fetch` is injected. Every failure below is forced with a stub rather
than assumed.

*What else can go wrong?* The dangerous direction is **resolving when it should not**: the ledger
writes a delivery row on a resolved send, and that row is what stops the alert ever being retried. A
false success is permanent silence for that finding.

*Could this happen anywhere else?* `chat-client.ts` makes the same argument in its own words — *"a
caller that turns a failure into an empty answer converts 'the records could not be reached' into
'there is nothing to report'"*. Here the cost is a warning nobody ever gets.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 10 | the network never produced a response | GUARD | stub throws; `MailNotSentError`, never a resolve |
| 11 | a non-2xx is treated as sent | GUARD | 400, 401, 429, 500 each rejected |
| 12 | the request has no timeout, so one unresponsive provider holds ingestion open | GUARD | the stub asserts a `signal` is present and aborts |
| 13 | the API key reaches the thrown message | GUARD | asserted absent from every rejection |
| 14 | the recipients reach the thrown message | GUARD | the error is read by whoever debugs; the list names directors |
| 15 | the provider's error body is echoed into the error | GUARD | providers echo the request, and the request holds every address |
| 16 | a 2xx whose body reports a failure is treated as sent | GUARD | `{ "error": … }` at 200 rejects |
| 17 | an empty recipient list is sent | GUARD | refused before `fetch` — a send with nobody to send to is not a send |
| 18 | a recipient list with a blank entry is sent | GUARD | refused; migration 023 refuses to record it either |
| 19 | the body is form-encoded, so the provider silently sees no recipients | GUARD | `content-type: application/json`, and the parsed body asserted |
| 20 | a partial delivery resolves | PROPAGATE-by-contract | `core/ports/mail.ts` states it; a provider that cannot confirm the whole list is a rejection |

**Cross-check.** #10 through #16 are one property approached seven ways, and it is the property the
whole task turns on: **this function resolves only when the message went.** The reverse check is #17
and #18 — it must also refuse to try when trying could not succeed, so a delivery row is never
written for a send that was never possible.

#### Task 5 — the wiring

**Behaviour: `notifyFindings(deps)` — everything the board has not been told about, told.**

*If it ran correctly, how would I know?* Every finding with no successful delivery is claimed once,
mailed once, and recorded — and the count returned says how many went, how many failed, and how many
another run already owned. Nothing it does can fail an upload.

*How am I going to test it?* Every collaborator is a port, so all of them are fakes. The clock is a
seam (`now`), because the staleness boundary is computed from it and a test cannot wait fifteen
minutes. `run-detection.ts` is the model for the whole shape and it has already argued each choice.

*What else can go wrong?* The failure that costs money is **silence**: an alert that is never sent
looks exactly like a month with no findings, because the dashboard still shows the finding and
nothing is broken enough to notice. So the guards are mostly about not stopping.

*Could this happen anywhere else?* `run-detection.ts` and `record-payments.ts` are the two siblings,
and `detection-wiring.test.ts` exists because a step that is silently never called *fails nothing*.
That is precisely the risk for a mailer nobody is watching, which is why this task carries a wiring
test of its own.

| # | Failure mode | Class | Forced by |
| --- | --- | --- | --- |
| 1 | a collaborator is absent, so alerts silently never happen and nothing fails | GUARD | returns `null`, and the wiring test asserts both call sites pass them |
| 2 | one finding's send failure stops the rest of the batch | GUARD | a fake that throws on the second of three; the first and third still go |
| 3 | a lost claim is treated as a failure, or as a send | GUARD | `claim` returning `false` counts as skipped and no mail is sent |
| 4 | the whole run throws and fails an upload that succeeded | GUARD | every collaborator throwing; resolves, never rejects |
| 5 | reporting the failure becomes the failure | GUARD | an `onError` that itself throws — the defect `run-detection.ts` fixed |
| 6 | a send that failed is recorded as sent | GUARD | `recordSent` never called on the throwing path |
| 7 | a send that succeeded is recorded as failed | GUARD | `recordFailure` never called on the success path |
| 8 | `recordSent` failing after a successful send loses the record, and the alert sends again | PROPAGATE-by-design | reported through `onError`; at-least-once is the stated contract, and this is the case that spends it |
| 9 | an empty board is treated as a send with no recipients | GUARD | no claim, no mail, no delivery row — migration 023 refuses that row anyway |
| 10 | the recipient list is read once per finding | GUARD | read once per run; asserted by call count |
| 11 | the staleness boundary is read from the wall clock | GUARD | `now` is injected; a test moves it rather than waiting |
| 12 | a stale claim is never retried, so a failed send is silence forever | GUARD | second run with a later clock re-claims and sends |
| 13 | the run is unbounded, so one upload sends hundreds of emails | GUARD | a cap, and the remainder is left for the next run |
| 14 | the cap silently drops findings with nothing saying so | GUARD | the outcome reports what was left |
| 15 | mail is unconfigured and the loop claims every finding anyway | GUARD | configuration is checked at the call site, so absent config is an absent collaborator |
| 16 | `onError` is handed the wrong kind of string | GUARD | it takes a finding id and says so — `ingest.ts` logged a uuid under the label `filename` and Argus caught it |

**Cross-check.** #6 and #7 are one property from both sides — the record must agree with what
happened — and it is the property the at-least-once guarantee rests on. #2 and #4 are the same for
the batch: one bad finding must cost exactly one finding.

### Completion Notes List

**Task 5 — the wiring.** `core/ingestion/notify-findings.ts`, its 23 tests, a wiring test over four
files, and `createAlerting` in the mail adapter.

*Both ingestion paths, not one.* A CSV is parsed at upload and never reaches the provider, so
`ingest.ts` and `extract-document.ts` are two different routes to a raised finding — wiring only the
deferred one would have alerted on scanned slips and stayed silent for the bank feeds the pilot
actually uploads. That is the mistake story 2.5 recorded making, one epic earlier, and the wiring
test now asserts the ordering (`notifyFindings` after `runDetection`) in both.

*Where this departs from `run-detection.ts`, deliberately.* That file swallows a failure and accepts
that the finding is missed until detection runs again — safe, because AD-13 makes re-running a no-op.
The same posture here would be wrong: a missed detection is recovered by the next upload, and a
missed alert is recovered by nothing. So a failure is **recorded against the finding** as well as
reported, the claim is left unsent, and a later run takes it over once it goes stale.

*Guarded:* an absent collaborator means do nothing rather than throw; one finding's failure costs
exactly one finding; a lost claim is neither a failure nor a send; an empty board claims nothing,
because taking ownership of a send that cannot happen would silence the association for a retry
window; the recipient list is read once per run; the run is bounded and the outcome says what it
left; reporting a failure cannot become the failure; and nothing here can fail an upload whose
document really was read.

*Configuration is resolved at the call site, not in `core/`.* `core/` imports nothing outward, so it
cannot read the environment — and `notifyFindings` already treats an absent collaborator as "do
nothing". `createAlerting` returns an empty object when mail is unconfigured, which a call site
spreads unconditionally. The alternative was letting the configuration error escape from the first
send, which would have claimed every finding before discovering it could deliver none.

*Sensitivity check:* four mutations, all detected. Recording a send that threw failed three tests;
treating a lost claim as a send failed five; letting one failure end the batch failed five; claiming
against an empty board failed one.

*Adversarial review (Argus, `auto`/`gemini-3.1-pro-high`, confidence 0.95, 14/14 files, 2 calls, 426k
tokens, audit chain OK):* four findings. Two were about `core/ingestion/ingest.ts`, which this story
only touched to add the notify call — the engine reviewed the neighbourhood.
- **confirmed, mechanism corrected (high)** — `fetch` follows redirects by default, which Argus said
  would leak the `Authorization` header to a third party. **Measured rather than argued:** a probe
  against two local servers on this runtime shows Node 24 strips `Authorization` across origins, so
  that mechanism does not hold. The real exposure is the **body** — it names a vendor, an amount and
  a unit, and following a redirect POSTs an association's finding to a host nobody configured.
  `redirect: 'error'` now makes a `MAIL_API_URL` that redirects fail loudly rather than deliver
  quietly to the wrong place. Right fix, better reason.
- **disagree (medium)** — `AbortSignal.timeout` was said to leak timers in the event loop. Probed: the
  timer is **unref'd** and does not hold the loop. At one association's upload rate a 15-second
  unref'd timer per send is not a leak worth an `AbortController` and a `finally`, and the
  replacement would be a code path with no test to justify it.
- **not-reproduced (high)** — *"`extractions.replace` throws a `RangeError` for assessment rolls,
  where `records` is empty."* It is not empty: `core/extraction/tabular.ts` pushes into **both**
  `records` and `rollRows` for every roll row, so a valid roll always has records. If this were true,
  story 2.7's roll upload would always have reported `figures-not-stored`.
- **deferred, narrow (high)** — *"`rollRows` is not checked for NUL bytes."* The overlapping fields
  are covered by the checks that do run: `holderName` and `unitNumber` come from the same cells as
  the record's `vendorName` and `unitReference`, and a roll row only exists alongside a valid record.
  What is genuinely unguarded is the roll-only `cycle` and `year`. Out of this story's scope — it is
  `ingest.ts`'s validation, not the alert path — and recorded as follow-up rather than fixed here.

**Task 4 — the adapter and its configuration.** `adapters/mail/env.ts`,
`adapters/mail/mail-sender-http.ts`, 33 tests, and the four variables in `.env.example`.

*The property the whole task turns on is approached from seven directions: this resolves only when
the message actually went.* The ledger writes a delivery row when `send` resolves, and that row is
what stops the alert ever being retried — so a false success is not a missed email, it is permanent
silence for that finding with a database record saying the board was warned. Guarded: a network that
never produced a response; seven non-2xx statuses; a 2xx whose body carries an error object, which is
the shape that most reliably becomes a delivery row for a message nobody received; a body that is not
JSON at all.

*And the reverse — it refuses to try when trying could not succeed.* An empty recipient list, a list
with a blank in it, and a blank subject are all rejected **before** `fetch`, so no delivery row is
written for a send that was never possible.

*Nothing thrown names a recipient or the key.* The error is read by whoever is working out why a
board was never warned, and providers echo the request back inside their error bodies — which is
exactly where every director's address is. Asserted against an error body that deliberately contains
both.

*Two variables, two different rules, and the difference is the point.* `MAIL_API_URL` is `https:`
only because the key travels to whatever it names. `WATCHDOG_BASE_URL` accepts `http:` because it is
an address a director's browser follows and carries no credential. Each has a test, and each test
names the other as its counterpart.

*Sensitivity check:* four mutations, all detected. Dropping the `response.ok` check failed seven
tests; dropping the 2xx error-object check failed one; echoing the provider's error body into the
thrown message failed the leak test; accepting a relative base URL failed the scheme test.

*One test was replaced rather than fixed.* The timeout assertion used Vitest's fake timers to advance
past `AbortSignal.timeout`, which runs on an internal timer the fake clock does not drive — so it
asserted a property of the signal object for reasons unrelated to the code. It is now an end-to-end
test with a real timer and a provider that never answers, forcing the thing anybody actually cares
about: an unresponsive provider ends as a rejection rather than as an upload that hangs while a
treasurer watches it.

*Adversarial review (Argus, `auto`/`gemini-3.1-pro-high`, confidence 0.95, 6/6 files, 1 call, 59k
tokens, audit chain OK):* three findings, all three confirmed.
- **confirmed (high)** — `MAIL_API_URL` permitted `http:`, which would put the bearer token on the
  wire in plaintext. A real defect, and this project's own precedent argued against what had been
  written: `chat-client.ts` requires `https:` for `AGENT_BASE_URL` in as many words, *"the token
  travels to whatever this names"*. Now `https:` only, driven by a test.
- **confirmed (medium)** — the non-2xx path threw without consuming the response body, and undici
  holds the socket until an unread body is garbage-collected. One leaked connection per upload while
  a provider is having a bad afternoon. The body is now **cancelled**, not read: reading it would put
  the provider's echo of the request within reach of the error message.
- **confirmed (low)** — a comment claimed the spread of `message.to` stopped a caller mutating the
  list after the body was built, which misreads `JSON.stringify` as anything other than synchronous.
  A comment asserting something untrue is the defect this repository has recorded before in a
  migration comment; the spread and the comment are both gone.

*Two repo guards fired, and both were right.* `docs/readme.test.ts` checks that every `.env.example`
variable is named in the README **and** that the README's stated count is correct. Adding four
variables broke both. Updated.

**Task 3 — the message a board member reads.** `core/findings/alert-email.ts` and 37 tests. The
title and the sentence are **taken** from `toFindingRow` and `toFindingDetail`, and the tests assert
them against those functions rather than against literals — so a legitimate wording change updates
all four surfaces together and drift fails here rather than in a board packet.

*Guarded:* twelve spellings of "newline" flattened to a space, never removed — removing joins the
words on either side and a board member reads a vendor that does not exist; truncation by code point
so the cap cannot split a surrogate pair; the ellipsis inside the cap rather than added to it; a
value that flattens to nothing drops its whole line rather than printing a label with nothing after
it; the link built from `findingRoute` and resolved with `new URL`, so a base with or without a
trailing slash gives one link; a subject asserted to be a single line whatever it was built from; an
unrecognised finding type and evidence of any shape degrade rather than throw.

*The negative assertions are the load-bearing ones.* AC6 forbids claiming an action the architecture
cannot take, and every positive assertion in this file passes against copy that *also* says
something false. So the whole rendered message is checked for "blocked", "on hold", "stopped",
"cancelled", "flagged to", "approved", "prevented", "frozen" — and for the UX-DR23 upgrade from
"possible duplicate" to a certainty.

*The control-character fixtures are built from code points, not typed as literals.* Three attempts
to write them as literals produced raw bytes in the source — a carriage return and a line feed
written as escapes in a tool argument arrive as the real bytes — which is the defect that has
reached this repository's source three times and which `docs/no-control-characters.test.ts` cannot
see, because it reads markdown only. Both files were verified byte-clean afterwards. The Bash tool
itself refused one of the attempts, which is the clearest possible statement of the problem.

*Sensitivity check:* three mutations. Stripping structure instead of replacing it with a space
failed three tests; writing the subject here instead of taking it from the row failed two. **The
third mutation — slicing by code unit — was not detected, and that is the finding.** The fixture
used an odd cap, so the cut landed cleanly between two emoji and produced no lone surrogate: the
test passed against the exact bug it was written for. Fixed to an even cap, re-run, and the mutation
now fails it. This is precisely what the review gate says the sensitivity pass is for — catching a
vacuous test that looked healthy.

*Adversarial review (Argus, `auto`/`gemini-3.1-pro-high`, confidence 0.95, 4/4 files, 1 call, 65k
tokens, audit chain OK):* five findings.
- **not-reproduced (four of them, all "high")** — every one argued that `undefined` bypasses a
  `=== null` check because the data originates in `jsonb`. It does not: `toFindingDetail` is the
  narrowing boundary and its types are `| null`, never `| undefined`. Verified in the real file
  rather than assumed — `table()` returns `ComparisonTable | null`, and `figuresOf` drops null
  values entirely so `Figure.value` is always a real string. The four evidence-shape tests
  (scalar, array, string, null) already exercise that path and pass. Loosening to `== null` would
  defend against a violation of a contract the type system enforces, and would mask it if
  `toFindingDetail` ever did return `undefined`.
- **confirmed (medium)** — the separator between comparison groups was an empty string interleaved
  *before* the null filter, and an empty string is not null. A table whose every record was
  unreadable therefore still looked non-empty and rendered its caption over blank lines — a heading
  promising evidence that is not there. Reachable, because `table()` returns null only when there
  are no rows at all. Row separation moved inside `block`, where it can see what actually survived;
  two tests drive it, including the one that stops the over-correction of dropping a block because
  *some* cell was missing.

**Task 2 — the ports, and the adapters the port change forced.** Three new ports
(`mail.ts`, `finding-alert.ts`, `board-recipients.ts`), a fourth read on `FindingReader`, and the
Postgres adapters for all of it. The adapters were not planned for this task: widening `FindingReader`
made `finding-reader-postgres.ts` stop compiling, and shipping a task with a type error to be fixed
later is the kind of debt that gets discovered by the next person.

*Shapes guarded:* `MailMessage` has no `html` field and its absence is asserted, so re-opening the
plain-text decision has to be a decision; `to` is a list, because a type that can hold one director
invites a caller to tell one and believe it told the board; `MailSender` cannot read; the ledger
declares no way to un-send or delete, which migration 023 refuses anyway — two statements of one
rule, safe because something fails when they disagree; `claim` returns `boolean` rather than `void`,
because a caller that cannot tell "I own this" from "somebody else does" sends anyway; `staleBefore`
is handed in, so the retry window is a value a test sets rather than a date a test waits for; the
recipient read is its own port, so sign-in does not acquire the ability to enumerate the board.

*The one place this project's usual rule is deliberately not applied:* `BoardRecipients.active()`
takes no `limit`. Every other read here is bounded because every other read is over a table that
grows; the board is a handful of directors. And a bounded read fails in exactly the direction this
story exists to prevent — a director silently dropped from a warning, with the alert looking sent and
the delivery row looking complete. The reason is written into the port so a later reader does not
"fix" it.

*Sensitivity check:* the adapter tests were written before the adapter but never observed red — the
module did not exist, so they failed on import rather than on an assertion. Three mutations stood in
for that, each on a load-bearing clause: dropping `claim`'s `sent_at is null` failed exactly the
test that staleness must not reopen a delivered alert; turning `awaitingAlert` into a plain
anti-join failed three, including the one that says a claimed-but-unsent finding is still a
candidate; dropping `disabled_at is null` failed the departed-director test. All restored, all green.

*Adversarial review (Argus, `auto`/`gemini-3.1-pro-high`, confidence 0.95, 14/14 files, 1 call, 188k
tokens, audit chain OK):* two findings, both verified.
- **confirmed, mechanism corrected (medium)** — `recordFailure` had no `sent_at is null` guard.
  Argus said this lets a stale worker write a failure onto a delivered alert. It does not:
  migration 023's trigger makes that state unrepresentable and *raises*. But raising is the defect —
  the exception escapes the loser's failure path and looks like the failure-recording itself broke.
  Guarded, and `recordSent` guarded with it, where the collision is worse: the loser would throw
  after having actually put an email in somebody's inbox.
- **confirmed for a different reason (medium)** — `recordFailure` sliced its argument unguarded.
  Argus was worried about `null` arriving from an untyped `catch`; the port types it `string`, and
  this project trusts an internal boundary. The real hole is representable in a `string`: a blank
  reason, which `finding_alert_failure_is_useful` refuses — so recording that the send failed would
  itself throw, and the alert would look like one nobody had ever tried. That is the length cap's
  defect from the other end, and `storable()` now closes both.

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
| `core/ingestion/notify-findings.ts` + `notify-findings.test.ts` | new — the loop, and 23 tests |
| `core/ingestion/alert-wiring.test.ts` | new — that four files really call it, and in the right order |
| `core/ingestion/extract-document.ts` | modified — the notify call and its dependencies |
| `core/ingestion/ingest.ts` | modified — the same, for the path a CSV takes |
| `app/upload/actions.ts`, `app/api/documents/[id]/extract/route.ts` | modified — the wiring and `createAlerting` |
| `adapters/mail/env.ts` | new — mail configuration and the public address, read at call time |
| `adapters/mail/mail-sender-http.ts` + `mail-sender-http.test.ts` | new — the send, and 33 tests |
| `.env.example` | modified — `MAIL_API_URL`, `MAIL_API_KEY`, `MAIL_FROM`, `WATCHDOG_BASE_URL` |
| `README.md` | modified — the migration count, and the two new variable groups |
| `core/findings/alert-email.ts` + `alert-email.test.ts` | new — the message, and `oneLine` |
| `core/ports/mail.ts` + `mail.test.ts` | new — the send port and the plain-text decision, enforced by the type |
| `core/ports/finding-alert.ts` + `finding-alert.test.ts` | new — claim, record sent, record failed |
| `core/ports/board-recipients.ts` + `board-recipients.test.ts` | new — who an alert goes to, and the split from `UserDirectory` |
| `core/ports/finding-reader.ts` | modified — `awaitingAlert`, the fourth read |
| `core/ports/finding-reader.test.ts` | modified — the exact member list, updated deliberately |
| `adapters/db/finding-alert-postgres.ts` | new — the ledger and the recipient read |
| `adapters/db/finding-alert-postgres.test.ts` | new — 20 tests against the database |
| `adapters/db/finding-reader-postgres.ts` | modified — `awaitingAlert`, and `toDetail` extracted so two reads cannot disagree |
| `migrations/023_finding_alert.sql` | new — the delivery record, its constraints, its lifecycle trigger and its grants |
| `migrations/finding-alert.test.ts` | new — 22 tests: 4 over the migration text, 18 against the database |


### Review Findings

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-16 | Story created. |
