-- An index on document.uploaded_by.
--
-- Postgres creates an index for a primary key and a unique constraint, but not
-- for a *referencing* column. Without one, every delete or key update on
-- board_member takes a sequential scan of document to check the reference --
-- cheap while the table is small, and quietly not cheap later.
--
-- The read side wants it too: "documents uploaded by this member" is the shape
-- the audit trail is asked for, and epic 2's catalog attributes figures to the
-- documents behind them.
--
-- Added as 005 rather than folded into 004 because 004 has already been applied
-- to a live database; an edit there would never run.
create index document_uploaded_by_idx on document (uploaded_by);

comment on index document_uploaded_by_idx is
  'Referencing columns get no index automatically. Without this, deleting a board_member scans document.';
