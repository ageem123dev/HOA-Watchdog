-- The record of what the board was told, and when.
--
-- AD-13: "Re-ingesting a document with an existing hash replaces that document's
-- derived rows rather than appending, and **never emits a second alert for a
-- finding already raised**."
--
-- ## Why this table exists at all
--
-- Migration 021 made the *finding* un-duplicatable. It did nothing about the
-- alert, because nothing sent one. So the second half of AD-13's sentence has
-- been, until now, a property of code that had not been written: a mailer would
-- have had to remember not to send twice, and remembering is what a unique
-- constraint exists to replace.
--
-- The failure that makes this worth a table rather than a boolean column on
-- `finding` is the one a board member actually experiences. A re-uploaded bank
-- statement re-runs detection; every detector amends rather than appends, so the
-- register stays correct — and an amend that mailed would deliver the same
-- warning a second time. The no-op would hold in the table and fail in the only
-- place anybody is looking.
--
-- It earns its place twice over. The register answers "what did the board know,
-- and when", and *when they were told* is part of that answer. A row here is
-- evidence that a director was notified on a date, which is exactly the kind of
-- claim a fiduciary record exists to support.
--
-- ## Claim, then send, and the row remembers which
--
-- Sending is not transactional. An email cannot be rolled back, and a database
-- write cannot be un-sent, so the two can only be ordered — and either order
-- loses something:
--
--   * Send first, then record. A crash between them sends the same warning again
--     on the next run, forever, because nothing ever records that it went.
--   * Record first, then send. A crash between them means the warning is never
--     sent and the record says it was.
--
-- Neither is acceptable on its own, so the row carries **both** moments.
-- `claimed_at` says a run took ownership of sending this alert; `sent_at` says
-- it succeeded. A row with a claim and no send is the recoverable state: a later
-- run whose claim has gone stale may take it over and try again.
--
-- The guarantee this buys is **at-least-once, not exactly-once**, and that is
-- stated here rather than left for a reader to assume the stronger one. A send
-- that succeeds and then fails to record its success will be sent again. That is
-- the right way round for a fiduciary warning: a duplicate email is a nuisance,
-- and a missed one is the thing this product exists to prevent.
--
-- ## `recipients` is stored, not counted
--
-- A count would answer "how many" and not "which", and "which" is the whole
-- question. A director asking why they were not told about something needs the
-- answer to be a list they can be absent from, not a number.
--
-- Addresses rather than board_member ids, deliberately. What matters afterwards
-- is where the mail actually went; an id resolves to whatever the row says
-- *today*, and a member whose address was corrected last month would make the
-- record silently claim the new one had been used.

-- Every address in the list is really an address.
--
-- A function rather than an expression, and not by preference: a CHECK constraint
-- may hold neither a subquery nor a set-returning call, so `unnest` is
-- unreachable from one. Written and then measured -- the inline form was tried
-- first and Postgres refused it.
--
-- Three holes closed by one `bool_and`, and they are three because each passes
-- the check written for the one before it:
--
--   * an empty array. `bool_and` over zero rows is NULL, so the `coalesce` is
--     what refuses it rather than an `array_length` test.
--   * a NULL element. `array_length` counts it, so a list of two where one is
--     null looks non-empty and still cannot say who was told.
--   * a blank element. Not null, not empty, and not an address. `btrim` is the
--     measurement migrations 009, 010 and 011 make on every human-supplied text
--     column here.
--
-- IMMUTABLE because a check constraint is re-evaluated on rewrite and must reach
-- the same answer every time; nothing here reads the row, the clock, or a
-- setting.
create function finding_alert_recipients_are_named(addresses text[]) returns boolean
language sql immutable as $$
  select coalesce(bool_and(address is not null and btrim(address) <> ''), false)
    from unnest(addresses) as address
$$;

create table finding_alert (
  id            uuid        primary key default uuidv7(),

  -- What was alerted about. A real finding, enforced: an alert row whose finding
  -- is absent claims a director was warned about something nobody can look up,
  -- which reads as answered rather than as missing.
  finding_id    uuid        not null references finding (id),

  -- When a run took ownership of sending this. Defaulted, never a caller's to
  -- choose -- the argument `FindingObservation` makes for omitting `raisedAt`.
  claimed_at    timestamptz not null default now(),

  -- When it actually went. NULL *is* the unsent state, and is the only thing a
  -- retry looks at.
  sent_at       timestamptz,

  -- Where it went. See the header for why addresses and not ids.
  recipients    text[],

  -- Why the last attempt did not go, for the operator who has to work out why a
  -- board was never warned. Capped: see the constraint.
  failure       text,

  -- AD-13's second sentence, as a rule of the table.
  constraint finding_alert_one_per_finding unique (finding_id),

  -- The sent state and its recipients cannot disagree.
  --
  -- Migration 021's `finding_review_is_attributed` applied to a different
  -- lifecycle, and for the same reason: a row claiming to be sent while naming
  -- nobody says a director was warned and cannot say which one, which is
  -- precisely what a delivery record exists to answer.
  --
  -- Three ways to name nobody -- an empty list, a list with a NULL in it, and a
  -- list with a blank string in it -- and all three are refused above, in
  -- `finding_alert_recipients_are_named`. The first is the one a mailer that
  -- found no enabled board members would actually write.
  constraint finding_alert_send_is_attributed check (
    (sent_at is null and recipients is null)
    or (
      sent_at is not null
      and recipients is not null
      and finding_alert_recipients_are_named(recipients)
    )
  ),

  -- A provider that echoes the request back in its error body would otherwise
  -- write the whole message -- including every recipient address -- into a
  -- column read by whoever is debugging. Bounded, and non-blank when present for
  -- the reason every other text column here is: a failure recorded as `''` says
  -- something went wrong and refuses to say what.
  constraint finding_alert_failure_is_useful check (
    failure is null or char_length(btrim(failure)) between 1 and 2000
  )
);

-- The retry sweep's read: unsent alerts, oldest claim first. An index that
-- arrives with the table costs nothing; one added later is a migration on a
-- table that only ever grows.
create index finding_alert_unsent_idx on finding_alert (claimed_at) where sent_at is null;

-- A delivery is final once it has happened.
--
-- `finding_alert_send_is_attributed` above cannot express this: a check
-- constraint sees one row, and it cannot see the row that was there before.
-- Clearing `sent_at` and `recipients` together is internally consistent, so the
-- constraint accepts it -- the identical wall migration 021 hit, answered the
-- identical way.
--
-- **Both ends, from the start.** Migration 021's first version of this trigger
-- fired on UPDATE alone, and a plain INSERT carrying the finished state walked
-- straight past it: the check constraint finds that row perfectly consistent,
-- and the writer holds INSERT on every column. Measured there, and paid for
-- there; this table starts with the correction rather than repeating the
-- lesson. An alert is claimed and then sent, or it is nothing.
--
-- What stays mutable is `claimed_at` and `failure`, and **only while the alert
-- is unsent**: the at-least-once guarantee depends on a stale claim being
-- re-claimable, and a trigger that froze the row entirely would satisfy every
-- refusal here and strand every failed send in exactly the silence this table
-- exists to remove.
--
-- Once it is sent the whole row is final, not merely the two columns that look
-- like they say so. A `claimed_at` moved forward on a delivered alert rewrites
-- when the board was told; a `failure` written onto one that succeeded is a
-- record contradicting itself, and an operator would resolve that contradiction
-- in whichever direction they read first. Raised by Argus, which noticed the
-- prose above claimed a restriction the first version of this trigger did not
-- enforce.
create function finding_alert_delivery_is_final() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.sent_at is not null or new.recipients is not null then
      raise exception
        'an alert is claimed before it is sent; sent_at and recipients belong to the send';
    end if;

    return new;
  end if;

  -- The row is the record of one finding. One UPDATE could otherwise move a
  -- delivery from the finding it was about to a different one with its
  -- timestamps intact, which is worse than a missing record: the register still
  -- looks complete. The argument migration 021 makes for `finding_identity`.
  if new.finding_id is distinct from old.finding_id then
    raise exception 'alert % is the record of one finding; that is its identity', old.id;
  end if;

  -- `new is distinct from old` compares the whole row, so this covers
  -- `claimed_at` and `failure` as well as the two delivery columns -- and it
  -- keeps covering any column a later migration adds, which naming them one by
  -- one would not.
  if old.sent_at is not null and new is distinct from old then
    raise exception 'alert % has been sent; that record is final', old.id;
  end if;

  return new;
end;
$$;

create trigger finding_alert_delivery_is_final
  before insert or update on finding_alert
  for each row execute function finding_alert_delivery_is_final();

-- Un-deletable is a grant, not a habit.
--
-- Migration 002's default privileges hand watchdog_writer DELETE on every table
-- created after it, so this table arrives deletable unless these lines take it
-- away again -- the same failure migrations 020 and 021 both name. The table
-- would look exactly right, the application would never issue a DELETE, and the
-- property would hold only for as long as nobody wrote one.
--
-- UPDATE is *not* revoked, and that is the distinction this migration turns on:
-- the claim is inserted before the send and stamped after it, so revoking UPDATE
-- would make the flow unimplementable -- and the mailer would discover it at
-- runtime, on the first real alert, having already sent the email.
revoke delete, truncate on finding_alert from watchdog_writer;
revoke delete, truncate on finding_alert from public;

-- Nothing is granted to watchdog_reader, and the silence is the decision --
-- migration 003 revoked its blanket SELECT so that read access became explicit
-- per table. Migration 021 said no for findings; this is the same no, one step
-- further on. A catalog entry that could read this table would let a question
-- about dues disclose which directors were warned about whom, which is a
-- sharper disclosure than the finding itself.

comment on table finding_alert is
  'One row per finding that has been alerted on, keyed unique on finding_id so AD-13''s "never a second alert" is a rule of the database rather than a habit of the mailer. Claim then send: claimed_at says a run took ownership, sent_at says it succeeded. The guarantee is at-least-once, not exactly-once -- a send that succeeds and fails to record it will be sent again, which is the right way round for a fiduciary warning.';
comment on column finding_alert.claimed_at is
  'When a run took ownership of sending this alert. A claim with no send is the recoverable state: a later run whose claim has gone stale may take it over.';
comment on column finding_alert.sent_at is
  'When the alert actually went. NULL is the unsent state and is the only thing a retry looks at.';
comment on column finding_alert.recipients is
  'The addresses the alert went to, not board_member ids and not a count. "Which" is the question a director asking why they were not told needs answered, and an id resolves to whatever the row says today rather than to the address actually used.';
comment on column finding_alert.failure is
  'Why the last attempt did not go. Capped so a provider echoing the request back cannot write every recipient address into a debugging column.';
