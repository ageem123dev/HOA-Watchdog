-- Which document wrote a tenure, so re-uploading a roll replaces its own rows.
--
-- Story 2.7. Stories 2.1 and 2.2 built `unit`, `unit_holder`, `unit_membership`
-- and `assessment` and nothing ever filled them; this is the column the
-- ingestion path needs to be idempotent, which AD-13 requires of every derived
-- row.
--
-- The problem it solves is specific. Re-applying a roll must not duplicate the
-- tenures it stated, and the only formulation that is exactly idempotent is
-- "delete what this document wrote, then write it again". Without a document
-- column there is no way to tell those rows from another roll's, so the
-- alternative is matching a tenure by its holder's name -- and migration 012
-- refused a unique constraint on `unit_holder.full_name` in as many words,
-- because an association's second `John Smith` must be recordable and folding
-- the two together would silently hand the first one the second one's unit.
--
-- Deliberately NOT added to `unit` or `assessment`, and the asymmetry is the
-- whole point of this migration:
--
--   * A unit is not owned by the document that first mentioned it. Three tables
--     reference `unit (id)` with no `on delete` action -- `unit_membership`,
--     `assessment` and `payment` -- so a cascade here would let deleting a roll
--     erase every payment ever recorded against its units. That is the hazard
--     this story was written around, and the absence of this column on `unit` is
--     what makes it unrepresentable rather than merely avoided.
--
--   * An assessment is keyed by `(unit_id, assessment_year)` and upserted at
--     that grain. Two rolls may legitimately state the same year -- a correction
--     -- and the later one wins without either owning the row.
--
-- Nullable, because rows written before this migration have no document and
-- inventing one would be a lie. A null means "recorded by something other than a
-- roll upload", which today means a test fixture or a hand-written insert.

alter table unit_holder
  add column document_id uuid references document (id) on delete cascade;

alter table unit_membership
  add column document_id uuid references document (id) on delete cascade;

-- The lookup the ingestion path makes on every re-apply: "what did this document
-- write last time". Without these, deleting a document's own rows scans both
-- tables, which on re-upload is the common case rather than the rare one.
create index unit_holder_document_id_idx on unit_holder (document_id);
create index unit_membership_document_id_idx on unit_membership (document_id);

comment on column unit_holder.document_id is
  'The roll document that recorded this person, or null if something other than an upload did. Cascades: deleting the document removes the rows it wrote. Deliberately absent from unit, whose rows outlive any one document.';
comment on column unit_membership.document_id is
  'The roll document that recorded this tenure, or null if something other than an upload did. What makes re-applying a roll replace its own tenures rather than duplicate them, without matching a holder by name.';
