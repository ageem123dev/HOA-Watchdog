-- What a treasurer changed about a column mapping, and what it did to the
-- documents already imported under the old one.
--
-- Story 5.7, AC6: "a re-import is a deliberate act with a record". Migration 026
-- stores the mapping that is current; this stores the fact that it changed. The
-- two are different questions, and only one of them survives being overwritten.
--
-- ## Why this is not columns on column_mapping
--
-- A mapping row is replaced in place -- that is what "one mapping per shape"
-- means, and 026's unique index enforces it. Anything recorded on that row about
-- a change is destroyed by the next change. A history table is the only shape
-- that can answer "what did this look like in March", which is the question a
-- board asks when a figure is disputed.
--
-- ## Un-editable, which column_mapping is not
--
-- 026 deliberately leaves UPDATE alone, because replacing a mapping is the whole
-- of story 5.7's second half. Here UPDATE is revoked along with DELETE: this
-- table's entire purpose is to say what happened, and a record of the past that
-- can be rewritten is not one. Migration 002's default privileges grant
-- watchdog_writer both on every table created after it, so both must be taken
-- away explicitly -- 023's finding, applied again.
--
-- ## Why the outcomes are jsonb and not rows
--
-- The per-document outcomes are read back as a set, always all together, always
-- for one change, never joined or aggregated. A child table would add a foreign
-- key, an index and a second insert per change to support queries nobody has.
-- `core/mapping/reimport.ts` owns the outcome vocabulary; this column stores what
-- it reported.

create table if not exists mapping_change (
  id uuid primary key default uuidv7(),
  association_id uuid not null references association (id),
  document_kind text not null,
  shape text not null,

  -- Null means this was the first mapping for the shape -- nothing was replaced.
  -- Distinct from an empty mapping, which would be a treasurer mapping nothing.
  previous_mapping jsonb,
  new_mapping jsonb not null,

  -- Who, and when. AC6 names both, and an audit row missing either is an
  -- assertion that something happened rather than a record of it.
  changed_by uuid not null references board_member (id),
  changed_at timestamptz not null default now(),

  -- Which documents were re-imported, and what happened to each. Per document,
  -- because AC7 refuses a single summarised "done".
  documents jsonb not null default '[]'::jsonb
);

-- The history of one shape, newest first, is the read this exists for.
create index if not exists mapping_change_by_shape
  on mapping_change (association_id, document_kind, shape, changed_at desc);

-- AD-4: migration 003 revoked watchdog_reader's blanket SELECT so read access is
-- explicit. Nothing is granted here. When a surface needs to show this history,
-- that grant is a decision made then, not one inherited now.

revoke update, delete, truncate on mapping_change from watchdog_writer;
revoke update, delete, truncate on mapping_change from public;
