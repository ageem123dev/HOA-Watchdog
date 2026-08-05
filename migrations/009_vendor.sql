-- Who the association pays, as one identity per vendor.
--
-- Every name here started as text a parser read off somebody's scan, so the
-- same vendor arrives spelled several ways. If those become several rows, each
-- holds a fraction of the history, and a duplicate invoice sits in a comparison
-- that never happens -- the anomaly this product exists to catch, missed with
-- no error anywhere.
--
-- So the identity is the *normalised* name, the database computes it, and a
-- unique index enforces it. Application code cannot forget to check.

-- Similarity ranking, for the quarantine queue that orders "did you mean"
-- candidates for a human. It ranks; it never resolves.
--
-- This needs a privileged migration runner: pg_trgm is a trusted extension, but
-- installing it still requires CREATE on the database. Verified on this
-- deployment -- the runner connects as `postgres`, while `watchdog_writer` is
-- refused with 42501 and has no need of it. On a managed instance whose runner
-- is unprivileged, this line is where the migration stops.
create extension if not exists pg_trgm;

-- The one definition of what makes two spellings the same vendor.
--
-- Written with chr() rather than a backslash class on purpose. Measured on this
-- database before this file existed: E'\\s+' matches the letter `s`, so
-- `Landscaping` normalises to `Land caping` -- plausible output, no error, and a
-- vendor history quietly split in two. chr() cannot be misread that way.
--
-- The separator set is NOT "whitespace", because that word means different
-- things here than it does in JavaScript. Postgres [[:space:]] excludes NBSP
-- (chr(160)) and narrow NBSP (chr(8239)); JavaScript's \s includes both. A PDF
-- extractor emits them. Naming the characters is what keeps the two engines
-- agreeing, and core/vendor/name.ts holds the identical list.
--
-- The fold is ASCII-only for the same reason: lower() and toLowerCase()
-- disagree on U+0130 and on final sigma. The cost is that a non-ASCII case
-- difference reads as a different vendor and goes to a human -- the safe
-- direction. A locale-dependent fold that silently merges two vendors is not.
create or replace function vendor_normalised_name(raw text)
  returns text
  language sql
  immutable
  strict
  parallel safe
as $$
  select translate(
           regexp_replace(
             btrim(raw, ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239)),
             '[' || ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239) || ']+',
             ' ',
             'g'
           ),
           'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
           'abcdefghijklmnopqrstuvwxyz'
         )
$$;

create table vendor (
  id              uuid        primary key default uuidv7(),

  -- What a human typed or confirmed, shown back to them unchanged. Vendors are
  -- referenced by id everywhere else; this column is for reading, not matching.
  display_name    text        not null,

  -- Generated, so it cannot disagree with the name it came from. A caller that
  -- tries to write it is refused by Postgres rather than trusted.
  normalised_name text        generated always as (vendor_normalised_name(display_name)) stored,

  created_at      timestamptz not null default now(),

  -- Bounded through the normalised form, so the whitespace-only case and the
  -- length case are one constraint rather than two that can disagree.
  -- char_length('   ') is 3: a bare length check calls a vendor made of spaces
  -- a valid vendor. Migration 006 learned that on extraction.vendor_name.
  --
  -- The upper bound matches VENDOR_NAME_MAX_LENGTH, which extraction already
  -- enforces on the column this resolves from. A page of OCR text or an
  -- injection payload arriving in a name field stops here.
  constraint vendor_display_name_length check (
    char_length(vendor_normalised_name(display_name)) between 1 and 200
  )
);

-- The identity rule, as a constraint rather than a convention. Two spellings of
-- one vendor collide here with 23505 even if every caller forgets to look.
create unique index vendor_normalised_name_key on vendor (normalised_name);

-- Ranking for the quarantine queue. Separate from the unique index above and
-- deliberately so: that one decides identity, this one only orders candidates
-- for a human to choose between.
create index vendor_normalised_name_trgm_idx on vendor using gin (normalised_name gin_trgm_ops);

-- Migration 003 revoked default SELECT for watchdog_reader, so read access is an
-- explicit decision per table rather than something a new table inherits.
--
-- Granted: FR-6 compares an invoice against the vendor's own history, and that
-- comparison runs on the read path. It needs to resolve a vendor id to a name.
--
-- SELECT only. The reader may never create a vendor: AD-8 says unknown vendors
-- route to a human-confirm queue and never auto-create, and a write grant here
-- would put vendor creation one prompt injection away.
grant select on vendor to watchdog_reader;

comment on table vendor is
  'Known vendors, one row per identity. The normalised name is the identity; display_name is for reading. Unknown names never auto-create a row (AD-8) -- they go to a human. Readable by watchdog_reader so FR-6 can compare an invoice against the vendor''s history (AD-4).';
comment on column vendor.normalised_name is
  'Generated. Separators folded, ends trimmed, ASCII case dropped. core/vendor/name.ts computes the identical value and a test runs both over a shared corpus -- if they ever disagree, one vendor becomes two.';
comment on function vendor_normalised_name(text) is
  'The identity rule for a vendor name. Changing it changes what counts as the same vendor, and requires rebuilding the generated column and its unique index.';
