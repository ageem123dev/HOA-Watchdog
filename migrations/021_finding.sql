-- A finding: something the system noticed, and the life it leads.
--
-- AD-13: "Re-ingesting a document with an existing hash replaces that document's
-- derived rows rather than appending, and never emits a second alert for a
-- finding already raised. Alerts are keyed on (finding_type, subject_id, period)
-- so re-processing is a no-op."
--
-- ## Why this table exists before any detector
--
-- Epic 4's headline feature is duplicate-invoice detection. Ship a detector
-- before this key exists and the second ingestion run raises the same finding
-- twice -- a duplicate-detection product manufacturing duplicates. The key is
-- not an optimisation to add later; it is the reason story 4.1 comes first.
--
-- ## `period` is a daterange, and that is a decision
--
-- The obvious alternative is text holding '2026-03'. It fails at exactly the job
-- this table exists to do: a detector writing '2026-3' and another writing
-- '2026-03' produce two rows for one month, and the unique constraint below
-- cannot see that they are the same period.
--
-- Postgres canonicalises a daterange, and this was measured against this
-- database rather than assumed: daterange('2026-03-01','2026-04-01','[)') and
-- daterange('2026-03-01','2026-03-31','[]') are both stored as
-- [2026-03-01,2026-04-01) and compare equal. Two spellings of March collapse to
-- one value, so the key cannot be defeated by formatting.
--
-- It also carries the domain as recorded on 2026-08-07: dues cycles are **per
-- member** -- monthly, six-monthly or annual. A monthly window and an annual one
-- are both ranges and do not collide, where a single global cadence would have
-- made a monthly payer and an annual payer indistinguishable for eleven months
-- of the year.
--
-- Canonicalisation cuts both ways, which is why finding_period_is_bounded below
-- exists: every empty range collapses to the same value too, so two unrelated
-- empty windows collide. See that constraint's comment.
--
-- NOT NULL, deliberately. A nullable period would need `nulls not distinct` for
-- the unique constraint to dedupe at all, and it lets a detector avoid saying
-- what window its finding concerns. Every finding is about a period of time;
-- being made to name it is the point.

create table finding (
  id            uuid        primary key default uuidv7(),

  -- What kind of thing was noticed. Held to the same `verb_noun` convention as
  -- catalog entry ids, for the same reason: this is a column a reader groups and
  -- joins on, and `Duplicate Invoice` and `duplicate_invoice` would be two
  -- finding types that are one finding type.
  finding_type  text        not null,

  -- What the finding is about. Deliberately untyped as a foreign key: a
  -- duplicate-invoice finding is about a document, a dues finding is about a
  -- unit, and a vendor-spike finding is about a vendor. Constraining it to one
  -- table would mean three tables, and three tables would mean three unique
  -- constraints and three ways to raise the same finding twice.
  subject_id    uuid        not null,

  -- The window the finding concerns. See the header.
  period        daterange   not null,

  -- The evidence, as the detector computed it. AD-6: entries return derived
  -- values, not the ingredients -- a vendor-spike finding stores the computed
  -- percentage over the trailing average, not the invoices it averaged.
  --
  -- jsonb so the register can be queried by key, and constrained to an object so
  -- an array or a scalar cannot masquerade as a set of evidence.
  evidence      jsonb       not null,

  raised_at     timestamptz not null default now(),

  -- The lifecycle, and there is no third state.
  --
  -- A board member cannot make a finding go away; they can only record that they
  -- have looked at it. That is fiduciary rather than cosmetic: a register that
  -- can be emptied is a register nobody can rely on, and "dismissed" is
  -- indistinguishable from "hidden by whoever did not want it seen".
  state         text        not null default 'unreviewed',

  reviewed_by   uuid        references board_member (id),
  reviewed_at   timestamptz,

  -- AD-13's key. This is the whole story in one line.
  constraint finding_identity unique (finding_type, subject_id, period),

  constraint finding_type_is_verb_noun check (finding_type ~ '^[a-z][a-z0-9_]*$'),

  -- The one way the key can still be defeated, and it was found by probing this
  -- database rather than by reasoning about it.
  --
  -- Postgres canonicalises *every* empty range to the single value `empty`, so
  -- [2026-05-01,2026-05-01) and [2026-09-09,2026-09-09) -- May and September,
  -- nothing alike -- compare equal and collide on finding_identity. Measured:
  -- the second insert updated the first row rather than adding one. That is the
  -- text-column defect arriving through a different door, and a detector
  -- computing a window from two dates that turn out equal produces it.
  --
  -- An unbounded bound fails differently: "from June onwards", read in 2030,
  -- covers four years it did not cover when it was written. A register of
  -- evidence cannot hold an entry that quietly grows. A detector meaning "still
  -- ongoing" bounds it at today, which says the same thing and keeps saying it.
  constraint finding_period_is_bounded check (
    not isempty(period) and lower(period) is not null and upper(period) is not null
  ),

  constraint finding_state_is_known check (state in ('unreviewed', 'reviewed')),

  -- The state and its evidence cannot disagree. A row claiming to be reviewed
  -- while naming nobody is worse than an unreviewed one: it says a human looked
  -- and cannot say which human, which is precisely what the register is for.
  constraint finding_review_is_attributed check (
    (state = 'unreviewed' and reviewed_by is null and reviewed_at is null)
    or
    (state = 'reviewed' and reviewed_by is not null and reviewed_at is not null)
  ),

  constraint finding_evidence_is_object check (jsonb_typeof(evidence) = 'object')
);

-- Story 4.5 renders the unreviewed list; 4.7 renders the register. Both read by
-- state and recency, and an index that arrives with the table costs nothing.
create index finding_state_recent_idx on finding (state, raised_at desc);

-- One-way is a rule of the table, not of the port.
--
-- `finding_review_is_attributed` above cannot express this: a check constraint
-- sees one row, and it cannot see the row that was there before. Setting state,
-- reviewed_by and reviewed_at all back to their unreviewed values is internally
-- consistent, so the constraint accepts it -- measured against this database
-- before this trigger was written.
--
-- Until then "no un-reviewing" was held only by `FindingReviewer` having no
-- method for it, which is the same shape as trusting the application not to
-- issue a DELETE. The property would have lasted exactly as long as nobody wrote
-- the statement, and re-reviewing would have let a second board member replace
-- the first one's name in the record of who looked.
--
-- What stays mutable is `evidence`, deliberately: a second detection run must
-- still be able to correct what a finding says, whether or not somebody has read
-- it. A rule that froze the reviewed row entirely would satisfy both refusals
-- and break the amend half of AD-13's contract.
create function finding_refuse_unreview() returns trigger
language plpgsql as $$
begin
  if old.state = 'reviewed'
     and (new.state       is distinct from old.state
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at) then
    raise exception
      'finding % is reviewed; its state and reviewer are final', old.id;
  end if;

  return new;
end;
$$;

create trigger finding_lifecycle_is_one_way
  before update on finding
  for each row execute function finding_refuse_unreview();

-- "Never dismissed" is a grant, not a habit.
--
-- Migration 002's default privileges hand watchdog_writer DELETE on every table
-- created after it, so this table arrives deletable unless it is taken away
-- again -- the same failure migration 020 named for query_log. The table would
-- look exactly right, the application would never issue a DELETE, and the
-- property would hold only for as long as nobody wrote one.
--
-- UPDATE is *not* revoked: raising a finding again must be able to correct its
-- evidence, and marking one reviewed is an update by definition. What must never
-- happen is a row leaving the table.
revoke delete, truncate on finding from watchdog_writer;
revoke delete, truncate on finding from public;

-- Nothing is granted to watchdog_reader, and the silence is the decision --
-- migration 003 revoked its blanket SELECT so that read access became explicit
-- per table. Findings are read by the gateway on behalf of a board member, and
-- the LLM-driven query path has no business reading them: a catalog entry that
-- returned findings would let a question about dues surface an unreviewed
-- accusation about a member.

comment on table finding is
  'Something the system noticed, keyed on (finding_type, subject_id, period) so re-running detection is a no-op (AD-13). Append-and-amend: no role may DELETE. The lifecycle is one-way, unreviewed to reviewed -- there is no dismissed state, because a register that can be emptied is one nobody can rely on.';
comment on column finding.period is
  'The window the finding concerns, as a daterange. Postgres canonicalises it, so two spellings of the same month collapse to one value and the unique constraint cannot be defeated by formatting. Ranges also carry per-member dues cycles -- monthly, six-monthly, annual -- without a global cadence.';
comment on column finding.subject_id is
  'What the finding is about -- a document, a unit, or a vendor depending on the type. Deliberately not a foreign key: constraining it to one table would mean three tables and three ways to raise the same finding twice.';
comment on column finding.evidence is
  'What the detector computed, as an object. AD-6: derived values, not the ingredients -- the percentage over the trailing average, not the invoices it averaged.';
