-- Every catalog execution, recorded before its rows are returned.
--
-- AD-12: "Each catalog execution appends an immutable record -- user id,
-- timestamp, catalog entry id and version, bound parameter values, and the exact
-- SQL text executed -- *before* the result is returned to the caller. The log is
-- append-only; no application role may UPDATE or DELETE it. A query path that
-- can execute without writing this record is a defect."
--
-- ## The ordering, and what it costs
--
-- The application writes this row and *then* runs the query. Both orderings
-- satisfy AD-12's literal words; only this one answers the question an audit
-- trail exists for. Logging afterwards records executions that succeeded, so an
-- agent induced into firing five hundred queries that all error leaves no trace
-- whatsoever -- and "what did it try?" is precisely what a board would ask.
--
-- The cost is real and belongs here rather than in a reviewer's discovery: the
-- log write and the query run on two connections under two roles, so they cannot
-- share a transaction. A row here is a statement of what was executed, not proof
-- that rows came back.
--
-- There is deliberately no `succeeded` column. Recording an outcome means going
-- back and UPDATEing the row, and the whole point of the grants below is that
-- nothing can. A later story that needs outcomes appends to a second table; it
-- does not soften this one.
--
-- ## append-only is a grant, not a habit
--
-- Migration 002's `alter default privileges` hands watchdog_writer SELECT,
-- INSERT, UPDATE and DELETE on every table created after it. This table
-- therefore arrives *writable*, and stays that way unless the revokes at the
-- bottom of this file take those back. That is the failure mode worth naming:
-- the schema would look exactly right, the application would never issue an
-- UPDATE, and the property would hold only for as long as nobody wrote one.

create table query_log (
  id            uuid        primary key default uuidv7(),

  -- Who asked. A real director, enforced -- an audit trail attributing a query
  -- to an id matching no board member is worse than one with a gap in it,
  -- because it looks answered.
  actor_id      uuid        not null references board_member (id),

  executed_at   timestamptz not null default now(),

  -- The catalog entry id, held to the `verb_noun` convention the architecture's
  -- Consistency Conventions state. The shape is checked rather than assumed for
  -- the reason every other text column in this schema is: this is the column a
  -- future reader joins the catalog on, and `Dues Status` and `dues_status`
  -- would be two entries that are one entry.
  --
  -- Two measurements answering two questions, the shape migration 009 reached
  -- after getting it wrong twice -- `char_length(btrim(...)) <= 64` lets 'x'
  -- plus three hundred spaces through, because btrim removes the padding before
  -- anything counts it.
  entry_id      text        not null,

  -- Versions start at 1 and only ever go up. AD-14 freezes a version's SQL once
  -- it is used, so `(entry_id, entry_version)` must resolve to exactly one SQL
  -- text forever -- and a version of 0 resolves to nothing at all.
  entry_version integer     not null,

  -- The bound parameter values, as an object keyed by parameter name.
  --
  -- `jsonb` and not `text`: this column exists to be read back and compared
  -- against what the entry declared, and text would turn a parameter set into a
  -- string nobody can query by key. The constraint below is what makes it an
  -- *object* -- a bare jsonb column accepts `[1,2]`, `"4B"` and `null`, three
  -- shapes no reader of this table could interpret and all three of them what a
  -- caller passing the wrong variable produces.
  parameters    jsonb       not null,

  -- The exact SQL that ran, verbatim rather than by reference.
  --
  -- AD-14 makes storing it and looking it up equivalent *today*, because a
  -- frozen version resolves to one text forever. They stop being equivalent the
  -- moment the catalog file is deleted, renamed or lost to a bad merge, and this
  -- table has to outlive all three: a fiduciary trail that cannot be replayed is
  -- worse than none.
  sql_text      text        not null,

  constraint query_log_entry_id_shaped check (
    char_length(entry_id) <= 64
    and entry_id ~ '^[a-z][a-z0-9_]*$'
  ),

  constraint query_log_version_positive check (entry_version > 0),

  constraint query_log_parameters_are_an_object check (
    jsonb_typeof(parameters) = 'object'
  ),

  constraint query_log_sql_text_present check (
    char_length(
      btrim(sql_text, ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239))
    ) >= 1
  )
);

-- Story 3.8 reads this table by entry and by recency. An index that arrives with
-- the table costs nothing; one added later is a migration on a table that only
-- ever grows.
create index query_log_entry_recent_idx on query_log (entry_id, executed_at desc);

-- The append-only property, taken back from the default privileges that granted
-- it away. Without these two statements `watchdog_writer` can rewrite any row in
-- this table, which was verified rather than assumed: the tests asserting the
-- refusal below failed against this migration before these lines existed.
--
-- TRUNCATE is included although migration 002 never granted it. It costs nothing
-- to revoke a privilege a role does not hold, and the alternative is a reader of
-- this file working out for themselves which of the three were reachable.
revoke update, delete, truncate on query_log from watchdog_writer;
revoke update, delete, truncate on query_log from public;

-- Nothing is granted to watchdog_reader, and the silence is the decision.
--
-- Migration 003 revoked the reader's blanket SELECT and its default privilege
-- precisely so that read access became an explicit choice per table. This is the
-- table where the answer is no: the role the LLM-driven query path executes
-- under has no business reading the audit trail of its own queries, which is the
-- argument migration 003 made for board_member. Story 3.8 surfaces this table
-- through the gateway, which holds the writer credential.

comment on table query_log is
  'Every catalog execution, appended before its rows are returned (AD-12). Append-only: watchdog_writer may INSERT and SELECT and nothing else. Not visible to watchdog_reader -- the LLM-driven query path has no business reading the audit trail of its own queries.';
comment on column query_log.parameters is
  'The bound parameter values as an object keyed by parameter name. jsonb so the trail can be queried by key; constrained to an object so an array or a scalar cannot masquerade as a parameter set.';
comment on column query_log.sql_text is
  'The exact SQL executed, stored verbatim rather than looked up by version, so the trail survives the catalog file being deleted or lost to a bad merge.';
