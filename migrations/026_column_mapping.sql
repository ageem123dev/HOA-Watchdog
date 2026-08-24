-- The mapping a treasurer set up once, so the next export of the same shape
-- imports without asking.
--
-- Story 5.7. Stories 5.4 through 5.6b built the draft, the preview, the
-- suggestion and the surface, and every one of them states that nothing is
-- stored because this is where a mapping is remembered. This table is that.
--
-- ## What identifies a mapping
--
-- Three things, and all three are identity rather than a filter on a query:
-- the association, the document kind, and the **shape** of the heading row it
-- was built against (`shapeKey` in core/mapping/saved.ts).
--
-- Dropping any one of them is a data defect, not an inconvenience. Without the
-- association, one board's export imports under another board's column
-- meanings. Without the kind, a deposit export reads as a roll. Without the
-- shape, a mapping made for one export is applied to a file whose columns sit
-- somewhere else — and because a mapping stores *positions*, every value would
-- still be a plausible value in the wrong field.
--
-- The unique constraint is what makes "one mapping per shape" a property of the
-- database rather than of whatever code last touched it — the arrangement
-- migration 023 uses for one alert per finding.
--
-- ## Why the mapping is jsonb and not columns
--
-- A mapping is a list of (target, position) pairs whose length varies by kind,
-- and `core/mapping/draft.ts` already owns its shape and its rules — `assign`
-- decides what a valid pairing is. Modelling the pairs as rows would put a
-- second answer to that question in the schema, and this project has spent four
-- review rounds on exactly that defect. The application validates on the way in
-- and on the way out; the column stores what it agreed.
--
-- ## Un-deletable is a grant, not a habit
--
-- Migration 002's default privileges hand `watchdog_writer` DELETE on every
-- table created after it, so this table arrives deletable unless this migration
-- takes it away — 023's finding, applied here.
--
-- Saving replaces through UPDATE, so DELETE is not needed for anything the
-- application does. It is revoked because deleting a mapping that documents were
-- already imported under raises the same question story 5.7 answered for
-- *changing* one: what happens to those documents. That question deserves a
-- deliberate answer, and revoking DELETE keeps it from being answered by
-- accident. UPDATE is not revoked — replacing a mapping is the whole of the
-- story's second half.

create table if not exists column_mapping (
  -- `uuidv7()`, as every table since migration 020 uses. Not
  -- `gen_random_uuid()`: this project settled on time-ordered ids and a table
  -- that differs would be the one nobody notices until an index behaves oddly.
  id uuid primary key default uuidv7(),
  association_id uuid not null references association (id),
  document_kind text not null,
  -- `shapeKey`'s output: JSON, so it is printable and unambiguous. Compared
  -- only for equality; the database never parses it.
  shape text not null,
  mapping jsonb not null,
  -- Who made this the mapping, and when. Story 5.7's AC6 — a mapping edit
  -- rewrites derived rows, so it is an act with an author.
  saved_by uuid not null references board_member (id),
  saved_at timestamptz not null default now()
);

-- One mapping per shape, refused by the database rather than remembered by the
-- application. The interesting case is two treasurers confirming the same
-- wizard at once, where no read-then-write is correct.
create unique index if not exists column_mapping_shape_is_unique
  on column_mapping (association_id, document_kind, shape);

-- AD-4: the reader's blanket SELECT was revoked by migration 003 so that read
-- access is explicit. Nothing is granted here, and the silence is the decision —
-- a column mapping is setup configuration, not association records, and no
-- catalog entry has any reason to read one.

-- Migration 024's convention, which this table is too new to be inside: every
-- association-scoped table carries a composite foreign key, "so a child cannot
-- belong to a different association than its parent". Without it the schema
-- permits a saver from one association against a mapping in another. The
-- adapter derives `association_id` from that member so the two always agree in
-- practice -- but 024's whole point is that the database refuses it rather than
-- the application remembering to. Raised by ocr.
--
-- The parent side of the composite key already exists: 024 gave `board_member`
-- `unique (id, association_id)`.
-- Migration 005's rule, stated on its own index: "Referencing columns get no
-- index automatically. Without this, deleting a board_member scans column_mapping."
-- Board members are disabled rather than deleted today, but 005 made this a
-- convention rather than a case-by-case judgement, and a referencing column
-- without one is the kind of omission noticed years later under load.
-- Raised by ocr.
create index if not exists column_mapping_saved_by_idx on column_mapping (saved_by);

-- Guarded, because every other statement in this file is idempotent and a
-- migration that fails on its second run is one nobody can safely re-apply.
-- `add constraint` has no `if not exists`, so 024's own pattern is used.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'column_mapping_id_association_key'
  ) then
    alter table column_mapping
      add constraint column_mapping_id_association_key unique (id, association_id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'column_mapping_saved_by_fk'
  ) then
    alter table column_mapping
      add constraint column_mapping_saved_by_fk
      foreign key (saved_by, association_id) references board_member (id, association_id);
  end if;
end $$;

revoke delete, truncate on column_mapping from watchdog_writer;
revoke delete, truncate on column_mapping from public;
