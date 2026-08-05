-- Who is currently extracting a document, and until when.
--
-- Extraction is deferred: the upload stores the bytes and returns, and a later
-- request reads them. That request costs seconds and money, so exactly one
-- caller may run it per document. The obvious place to enforce that is a lock
-- around the write -- and it is the wrong place. Story 1.5b's replacement takes
-- a lock on the parent row *inside* its transaction, which serialises the cheap
-- part while leaving the expensive part to run twice: two pollers both call the
-- provider, both get an answer, and then queue up politely to overwrite each
-- other. The system pays twice and keeps whichever finished last.
--
-- So the claim is taken *before* the call, and it lives in the database rather
-- than in a process, because two application instances share no memory.

alter table document
  add column extraction_claim_token uuid,
  -- Read as "this claim is void from here on". Compared against now() by the
  -- database, so there is exactly one clock: comparing against a timestamp the
  -- application supplies would give every instance its own, and clock skew
  -- would decide who owns a document.
  add column extraction_claim_expires_at timestamptz;

-- Both columns or neither. A token with no expiry is a claim nothing can ever
-- reclaim -- a dead process would hold the document permanently, which is the
-- failure expiry exists to prevent.
alter table document
  add constraint document_extraction_claim_complete check (
    (extraction_claim_token is null and extraction_claim_expires_at is null)
    or (extraction_claim_token is not null and extraction_claim_expires_at is not null)
  );

-- Deliberately NOT a fifth value in document_extraction_state_known.
--
-- "Extracting" is what the surface shows, derived from `held` plus a live claim.
-- Making it durable would mean a process that dies mid-extraction leaves its
-- document in a state with nothing to move it out -- and the recovery path would
-- have to be a sweeper that guesses when "extracting" has gone stale, which is
-- the expiry below wearing a worse hat.
--
-- The state stays `held` for the whole run. A crash leaves a claim that expires
-- and a document that is still, accurately, held and waiting.

comment on column document.extraction_claim_token is
  'Owner of the in-flight extraction. Re-checked inside the finalising transaction: expiry creates a second claimant by design, so the first may still be running and must not be allowed to overwrite the fresher result.';

-- No index is added here on purpose.
--
-- The claimable set is "held, and either unclaimed or expired", and migration
-- 007 already indexes (uploaded_at) where extraction_state = 'held'. A second
-- index over the same rows with the same predicate would be a duplicate: it
-- costs a write on every insert and update to that column and answers no query
-- the first one cannot. The claim columns are read by id, which the primary key
-- already serves.
