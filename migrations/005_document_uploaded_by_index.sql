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
--
-- Deliberately NOT `create index concurrently`.
--
-- A plain create index takes a lock that blocks writes to document while it
-- builds. That is the right trade here, and it will not always be:
--
--   * scripts/migrate.mjs wraps each migration in begin/commit, and
--     `concurrently` cannot run inside a transaction. Using it means teaching
--     the executor to run some migrations without one.
--   * That change carries its own failure mode. A `concurrently` build that
--     fails leaves an INVALID index behind, which costs writes while serving no
--     reads and has to be dropped by hand -- and it cannot be rolled back with
--     the rest of the migration, precisely because it is outside the
--     transaction.
--   * document holds approximately nothing at the moment this runs. The lock is
--     measured in milliseconds.
--
-- This reasoning expires the first time an index is added to a document table
-- already holding a real association's history. The executor should gain
-- non-transactional migration support then, for a case that needs it, rather
-- than now for one that does not.
create index document_uploaded_by_idx on document (uploaded_by);

comment on index document_uploaded_by_idx is
  'Referencing columns get no index automatically. Without this, deleting a board_member scans document.';
