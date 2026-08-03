-- AD-4: roles separate by pipeline stage, not by service.
--
-- `watchdog_writer` is used only by the ingestion path (and by sign-in, which
-- re-hashes a password when the cost factor is raised). `watchdog_reader` is
-- SELECT-only and is the only role a catalog query ever executes under, so a
-- prompt-injected agent cannot mutate anything regardless of what it is induced
-- to attempt.
--
-- Passwords are NOT set here. The migration runner sets them with ALTER ROLE from
-- generated values, so no credential is ever committed to this repository.
--
-- Grants are written explicitly and reviewably. If you are reviewing a change to
-- this file: any grant of INSERT, UPDATE, DELETE or TRUNCATE to watchdog_reader
-- is a violation of AD-4, and `migrations/roles.test.ts` proves it by connecting
-- as that role and asserting the write fails.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'watchdog_writer') then
    create role watchdog_writer login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'watchdog_reader') then
    create role watchdog_reader login;
  end if;
end
$$;

-- Neither role may create objects; the schema is owned by the migration runner.
revoke create on schema public from public;
revoke create on schema public from watchdog_writer, watchdog_reader;

grant usage on schema public to watchdog_writer, watchdog_reader;

-- Writer: read and write. DELETE is included because AD-13 requires re-ingesting
-- a document to *replace* its derived rows rather than append to them.
grant select, insert, update, delete on all tables in schema public to watchdog_writer;
grant usage, select on all sequences in schema public to watchdog_writer;

-- Reader: SELECT and nothing else.
grant select on all tables in schema public to watchdog_reader;

-- Belt and braces: strip anything the reader may have picked up from a default
-- or from an earlier migration. A grant it never had costs nothing to revoke.
revoke insert, update, delete, truncate on all tables in schema public from watchdog_reader;

-- Tables created by later migrations must inherit the same split, or AD-4 holds
-- only for the tables that happened to exist today.
alter default privileges in schema public
  grant select, insert, update, delete on tables to watchdog_writer;
alter default privileges in schema public
  grant usage, select on sequences to watchdog_writer;
alter default privileges in schema public
  grant select on tables to watchdog_reader;
