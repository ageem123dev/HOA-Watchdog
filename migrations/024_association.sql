-- The association, and the column that says which one a row belongs to.
--
-- AD-5 (amended 2026-08-18): "Every catalog entry filters by association. An
-- entry whose SQL does not is a defect, caught by a test over the registry."
--
-- ## Why every table carries the column rather than reaching one through a parent
--
-- A catalog entry that reached its association by joining upward would have to
-- carry that join in every query, and a query that omits it is exactly the
-- defect the registry test exists to catch — but a test can only check for a
-- predicate it can see. A column on every table makes the predicate uniform,
-- and uniform is what a structural test can enforce.
--
-- ## Why denormalising it is safe
--
-- The obvious objection to a column on fourteen tables is that a child could
-- end up in a different association than its parent. That is prevented rather
-- than guarded: every foreign key between two scoped tables gains a **composite**
-- partner carrying `association_id` on both sides, so the inconsistent row
-- cannot be written at all. No runtime check, no reviewer vigilance.
--
-- The single-column foreign keys are deliberately left in place rather than
-- dropped and replaced. This migration runs against a database with real rows
-- in it, and additive is the property worth having there: nothing this file does
-- removes a constraint, a column, or a table. The redundancy is the price.
--
-- ## Why the id is a constant
--
-- The pilot association is seeded at a fixed UUID so replay cannot create a
-- second one and cannot re-point existing rows. Every backfill below is
-- `where association_id is null` for the same reason: running this twice is a
-- no-op, not a rewrite.
--
-- ## What this migration does NOT do
--
-- It does not enable multi-tenancy. There is no row-level security, so scoping
-- is by construction — a correct catalog filter and a correct gateway binding,
-- two pieces of code that must both be right. AD-4's amendment names the day a
-- second association is onboarded as the trigger for RLS, and nothing in the
-- product creates one.

create table if not exists association (
  id         uuid primary key default uuidv7(),
  name       text        not null,
  created_at timestamptz not null default now(),

  constraint association_name_not_blank check (char_length(btrim(name)) > 0),
  constraint association_name_length check (char_length(name) <= 200)
);

insert into association (id, name)
values ('00000000-0000-7000-8000-000000000001', 'demo')
on conflict (id) do nothing;

-- The column, its backfill, and its constraint, one table at a time. Explicit
-- rather than a loop over a table list: a migration is read as a diff, and a
-- loop hides which tables were actually touched.

alter table board_member add column if not exists association_id uuid;
update board_member set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table board_member alter column association_id set not null;

alter table document add column if not exists association_id uuid;
update document set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table document alter column association_id set not null;

alter table extraction add column if not exists association_id uuid;
update extraction set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table extraction alter column association_id set not null;

alter table vendor add column if not exists association_id uuid;
update vendor set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table vendor alter column association_id set not null;

alter table quarantine_item add column if not exists association_id uuid;
update quarantine_item set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table quarantine_item alter column association_id set not null;

alter table unit add column if not exists association_id uuid;
update unit set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table unit alter column association_id set not null;

alter table unit_holder add column if not exists association_id uuid;
update unit_holder set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table unit_holder alter column association_id set not null;

alter table unit_membership add column if not exists association_id uuid;
update unit_membership set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table unit_membership alter column association_id set not null;

alter table assessment add column if not exists association_id uuid;
update assessment set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table assessment alter column association_id set not null;

alter table payment add column if not exists association_id uuid;
update payment set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table payment alter column association_id set not null;

alter table held_payment add column if not exists association_id uuid;
update held_payment set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table held_payment alter column association_id set not null;

alter table query_log add column if not exists association_id uuid;
update query_log set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table query_log alter column association_id set not null;

alter table finding add column if not exists association_id uuid;
update finding set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table finding alter column association_id set not null;

alter table finding_alert add column if not exists association_id uuid;
update finding_alert set association_id = '00000000-0000-7000-8000-000000000001' where association_id is null;
alter table finding_alert alter column association_id set not null;

-- Constraints are added through a guard because Postgres has no
-- `add constraint if not exists`, and this file must be replayable.

do $$
declare
  scoped text;
  parent record;
begin
  foreach scoped in array array[
    'board_member', 'document', 'extraction', 'vendor', 'quarantine_item',
    'unit', 'unit_holder', 'unit_membership', 'assessment', 'payment',
    'held_payment', 'query_log', 'finding', 'finding_alert'
  ]
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = scoped || '_association_fk'
    ) then
      execute format(
        'alter table %I add constraint %I foreign key (association_id) references association (id)',
        scoped, scoped || '_association_fk');
    end if;

    -- A composite foreign key needs a matching unique key on the parent.
    if not exists (
      select 1 from pg_constraint
       where conname = scoped || '_id_association_key'
    ) then
      execute format(
        'alter table %I add constraint %I unique (id, association_id)',
        scoped, scoped || '_id_association_key');
    end if;
  end loop;

  -- Every existing foreign key between two scoped tables gains a composite
  -- partner, so a child cannot belong to a different association than its
  -- parent. MATCH SIMPLE is deliberate: where the referencing column is
  -- nullable (`finding.reviewed_by`, for one), a null reference skips the check
  -- rather than forcing a value that does not exist.
  for parent in
    select * from (values
      ('assessment',      'unit_id',     'unit'),
      ('document',        'uploaded_by', 'board_member'),
      ('extraction',      'document_id', 'document'),
      ('finding',         'reviewed_by', 'board_member'),
      ('finding_alert',   'finding_id',  'finding'),
      ('held_payment',    'document_id', 'document'),
      ('payment',         'unit_id',     'unit'),
      ('payment',         'document_id', 'document'),
      ('quarantine_item', 'document_id', 'document'),
      ('query_log',       'actor_id',    'board_member'),
      ('unit_holder',     'document_id', 'document'),
      ('unit_membership', 'document_id', 'document'),
      ('unit_membership', 'unit_id',     'unit'),
      ('unit_membership', 'holder_id',   'unit_holder')
    ) as t(child, child_column, parent_table)
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = parent.child || '_' || parent.child_column || '_association_fk'
    ) then
      execute format(
        'alter table %I add constraint %I foreign key (%I, association_id) references %I (id, association_id)',
        parent.child,
        parent.child || '_' || parent.child_column || '_association_fk',
        parent.child_column,
        parent.parent_table);
    end if;
  end loop;
end
$$;
