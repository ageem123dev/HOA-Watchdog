-- Where a document has got to, as something the database holds rather than
-- something the application infers.
--
-- Until now "has this been read?" was answered by looking for extraction rows.
-- That works for exactly one of the four outcomes story 1.5d has to render. The
-- other three -- held and not yet read, the provider could not answer, and the
-- provider answered with something untrustworthy -- are all *no rows*, and a
-- treasurer needs to be told a different thing in each case:
--
--   held                  we have your document, we have not read it yet
--   read                  the figures are recorded
--   unreadable            it was read and the figures could not be trusted; a
--                         better scan may help
--   provider_unavailable  we could not read it just now; nothing is lost and it
--                         will be retried -- this is not your document's fault
--
-- The last two are the pair this project keeps having to separate. Story 1.5b
-- shipped a single `failed` outcome whose copy said the document was not saved
-- when it had been, and had to add a second name to undo it. `failed` is
-- deliberately absent from the vocabulary below for that reason.

alter table document
  add column extraction_state text not null default 'held';

-- A closed vocabulary the database enforces, in the same style as
-- extraction_kind_known. The application has a matching constant and a test
-- reads this file to prove the two agree -- a second statement of a shape is
-- only safe when something fails on disagreement.
--
-- Note what this constraint does *not* do: it constrains values, not sequences.
-- Which transitions are legal is the application's business, and pretending
-- otherwise here would put a state machine in a check constraint where nobody
-- would look for it.
alter table document
  add constraint document_extraction_state_known check (
    extraction_state in ('held', 'read', 'unreadable', 'provider_unavailable')
  );

-- The default matters for the rows that already exist. Documents uploaded
-- before this migration have bytes and no extraction, which is exactly `held` --
-- so backfilling is the default doing its job rather than a separate step. A
-- nullable column would have made "not yet read" and "we never knew" the same
-- value, which is the ambiguity this whole migration exists to remove.

-- The reader already holds SELECT on document (004), and that grant covers new
-- columns, so the catalog can attribute a state to a document without a further
-- grant. It remains SELECT-only: AD-4 means the LLM query path can read where a
-- document has got to and can never move it.

-- Finding the documents that still need reading is the deferred pass's whole
-- job, and it runs on a schedule rather than once. Partial, because three of the
-- four states are terminal for that query and there is no reason to index them.
create index document_awaiting_extraction_idx
  on document (uploaded_at)
  where extraction_state = 'held';
