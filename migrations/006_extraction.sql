-- What a document was read to say.
--
-- Every value here came out of a parser reading a file somebody uploaded, so
-- the constraints below are not type hygiene -- they are the difference between
-- a figure a board can act on and a plausible-looking guess. The dangerous
-- inputs are never gibberish; they are an empty vendor name that looks like
-- data, or a page of text arriving in a name field.

create table extraction (
  id            uuid        primary key default uuidv7(),

  -- One live extraction per document, and the database decides it.
  --
  -- Re-ingesting known bytes must replace what was read, not add a second
  -- reading. An application-level check reads, finds none, and inserts -- and
  -- two concurrent re-ingests both find none and both insert, leaving the
  -- catalog to pick between two answers arbitrarily. The unique constraint
  -- makes that unrepresentable and lets the writer use a single upsert, so
  -- there is never a moment when a document has lost its extraction.
  --
  -- Cascade because an extraction without its document is not a record of
  -- anything; it is debris that still satisfies a foreign key.
  document_id   uuid        not null unique references document (id) on delete cascade,

  document_kind text        not null,
  vendor_name   text,
  document_number text,
  issued_on     date,

  -- numeric, never a float. A binary float cannot represent 0.10, and this is
  -- an association's ledger. 14,2 admits amounts up to a trillion, which is far
  -- past any plausible HOA figure and stops a misread from being stored as one.
  --
  -- Negative means a credit to the association. A statement genuinely shows
  -- one, and the alternative -- amounts always positive with direction carried
  -- elsewhere -- needs a column this table does not have. Stated here so the
  -- anomaly detection that reads it later reads a decision rather than an
  -- accident.
  total_amount  numeric(14,2),

  currency      text        not null,
  extracted_at  timestamptz not null default now(),

  constraint extraction_kind_known check (
    document_kind in ('invoice', 'statement', 'assessment_roll', 'other')
  ),

  -- Absent and present-but-empty are different facts, and only one of them is
  -- legitimate. A statement has no vendor, so null is allowed. An empty string
  -- is a parser that found nothing and reported it in the wrong vocabulary --
  -- it would flow downstream as a real vendor named "".
  --
  -- The upper bound is the more load-bearing half: without it, a page of OCR
  -- text or an injection payload lands in a field the catalog will hand to the
  -- reasoning side as a vendor identity.
  constraint extraction_vendor_name_length check (
    vendor_name is null or char_length(vendor_name) between 1 and 200
  ),
  constraint extraction_document_number_length check (
    document_number is null or char_length(document_number) between 1 and 64
  ),

  -- The pilot handles one currency. This is a list rather than an equality so
  -- adding another is an obvious edit, and it exists so a misread 'EUR' or a
  -- fragment of a header cannot be stored as if it were money.
  constraint extraction_currency_supported check (currency in ('USD'))
);

-- Migration 003 revoked default SELECT for watchdog_reader, so read access is an
-- explicit decision per table rather than something a new table inherits.
--
-- Granted: epic 2's catalog has to attribute a figure to the document it came
-- from, and that is what this table is for.
--
-- The AD-10 tension is resolved by what this table does not have. vendor_name
-- and document_number are bounded typed fields, not raw extracted text, and
-- AD-8 governs them further -- vendor identities resolve against a known-vendor
-- table, and extracted strings are never interpolated into prompts.
--
-- No column here may ever hold raw OCR text or a document body. Adding one
-- would put raw extracted text one catalog entry away from the reasoning side,
-- which AD-10 forbids, and this grant would have to become per-column.
grant select on extraction to watchdog_reader;

comment on table extraction is
  'What a document was read to say. One live extraction per document -- re-reading replaces rather than appends (AD-13). Readable by watchdog_reader so the catalog can cite a figure''s source (AD-4).';
comment on column extraction.total_amount is
  'numeric, never a float. Negative means a credit to the association.';
comment on column extraction.vendor_name is
  'Bounded and typed, never raw extracted text. Resolution against known vendors happens elsewhere (AD-8).';
