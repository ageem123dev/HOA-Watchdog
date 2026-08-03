-- Documents the board has uploaded: the only way ledger data enters this system.
--
-- The bytes live in object storage; this table is the record that they exist, who
-- put them there, and what they hash to. Nothing here holds document content, so
-- the LLM-driven query path can be granted SELECT without gaining any route to the
-- text of an invoice (AD-8, AD-10).

create table document (
  id            uuid        primary key default uuidv7(),
  -- SHA-256 of the bytes as uploaded, computed before anything parses them. This
  -- is the identity AD-13 turns on: re-ingesting the same bytes must replace the
  -- derived rows rather than append a second set.
  content_hash  text        not null,
  storage_key   text        not null,
  filename      text        not null,
  content_type  text        not null,
  byte_size     bigint      not null,
  -- Nulled rather than deleted elsewhere in this schema so the audit trail keeps
  -- its actor; the same reasoning makes attribution mandatory here.
  uploaded_by   uuid        not null references board_member (id),
  uploaded_at   timestamptz not null default now(),

  -- One digest has one spelling. Without a canonical form, the same bytes under an
  -- upper-case or whitespace-padded hash are two rows, and the uniqueness
  -- constraint below silently stops meaning what it says.
  constraint document_content_hash_is_sha256 check (content_hash ~ '^[0-9a-f]{64}$'),

  -- AD-13, enforced by the database rather than by the ingestion path.
  --
  -- An application-level check reads the table, finds the hash absent, and
  -- inserts. Two uploads arriving together both read before either writes, so both
  -- find it absent and both insert. In a product whose headline feature is
  -- duplicate-invoice detection, an ingestion path that manufactures duplicates
  -- under concurrency is the defect it exists to find. Only the database closes
  -- that race, and it is scoped to the hash alone: the same bytes under a
  -- different filename are the same document.
  constraint document_content_hash_unique unique (content_hash),

  constraint document_byte_size_positive check (byte_size > 0),
  constraint document_filename_length check (char_length(filename) between 1 and 255),
  constraint document_storage_key_length check (char_length(storage_key) between 1 and 1024),

  -- The accepted set from FR-1, made unrepresentable rather than merely validated.
  -- The ingestion layer needs the same list to phrase its rejection message, and
  -- two copies of a list drift. Whichever module owns that list must assert parity
  -- with this constraint, so a type accepted at the edge and refused here fails the
  -- build rather than a board member's upload.
  constraint document_content_type_supported check (
    content_type in (
      'application/pdf',
      'image/png',
      'image/jpeg',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  )
);

-- Migration 003 revoked default SELECT for watchdog_reader, so read access is now
-- an explicit decision per table rather than something a new table inherits.
--
-- This one is granted: the catalog needs to attribute a figure to the document it
-- came from, and the row holds metadata only. The bytes are in object storage,
-- which the reader has no credential for and no route to.
grant select on document to watchdog_reader;

comment on table document is
  'Uploaded source documents. Metadata only -- the bytes live in object storage. Readable by watchdog_reader so the catalog can cite a figure''s source (AD-4, migration 004).';
comment on column document.content_hash is
  'SHA-256 of the bytes as uploaded, computed before extraction. Unique: re-ingesting the same bytes replaces derived rows rather than appending (AD-13).';
comment on column document.storage_key is
  'Key of the object holding the bytes. The bytes are never stored in this database.';
