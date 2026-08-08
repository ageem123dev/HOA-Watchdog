-- A deposit is a kind of document, and one of its lines can name a unit.
--
-- Story 2.4. A deposit is a bank paying-in slip or a batch of receipts: one
-- uploaded file, many payments, each settling a different unit. Migration 006
-- already allows many extraction records per document for exactly this shape --
-- "the pilot ingests bank feeds as CSV, where a single upload is hundreds of
-- lines" -- so nothing about the cardinality changes here.
--
-- What was missing is smaller and more specific: a deposit was not a document
-- kind, and an extracted line had no way to say which unit it paid for.

-- The vocabulary is restated in full, not appended to.
--
-- A check constraint cannot be extended in place; it is dropped and recreated.
-- Restating the whole list is therefore not a choice, and it has a consequence
-- worth naming: **migration 006 no longer states the current vocabulary**. Any
-- test that reads 006 to learn which kinds are admitted is reading a stale
-- answer from this point on. `core/extraction/record.test.ts` did exactly that,
-- and now scans every migration and takes the last definition -- which is what
-- the database itself does.
alter table extraction drop constraint extraction_kind_known;

alter table extraction
  add constraint extraction_kind_known check (
    document_kind in ('invoice', 'statement', 'assessment_roll', 'deposit', 'other')
  );

-- Which unit a line pays for, as the document spelled it.
--
-- Nullable, and null for almost every document: an invoice pays a vendor, a
-- statement names nobody. Only a deposit line carries one.
--
-- Deliberately **not** `vendor_name`. Reusing that column would have needed no
-- migration at all, and it would have fed unit identity through
-- `vendor_normalised_name()` -- the coupling migration 011 refused in as many
-- words, because a later change to how vendor names are matched would then
-- silently change which units are considered the same unit.
--
-- The raw reference stays here. Resolving it to a `unit.id` happens when the
-- payment is written, against `unit_normalised_number()`, and a reference that
-- does not fold to a known unit is held for a human rather than guessed at.
alter table extraction add column unit_reference text;

-- Measured twice, the shape migration 009 arrived at and 006 got wrong first:
-- `char_length(btrim(x, ...)) between 1 and 64` lets 'x' plus three hundred
-- spaces through, because btrim removes the padding before anything counts it.
--
--   char_length(unit_reference) <= 64  -- how much is actually stored
--   char_length(btrim(...))     >= 1   -- whether anything is actually there
--
-- Null passes: most documents have no unit reference, and absence is not
-- emptiness. 64 matches `unit.unit_number`, since this is the same thing read
-- off a different document.
alter table extraction
  add constraint extraction_unit_reference_length check (
    unit_reference is null
    or (
      char_length(unit_reference) <= 64
      and char_length(
        btrim(unit_reference, ' ' || chr(9) || chr(10) || chr(13) || chr(11) || chr(12) || chr(160) || chr(8239))
      ) >= 1
    )
  );

comment on column extraction.unit_reference is
  'Which unit a deposit line pays for, as the document spelled it. Null for every other document kind. Resolved against unit_normalised_number() when the payment is written; never through vendor_normalised_name().';
