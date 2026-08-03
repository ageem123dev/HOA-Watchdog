-- Closing three gaps in AD-4 that adversarial review found in migration 002.
--
-- 002 asserted that "a prompt-injected agent cannot mutate anything regardless of
-- what it is induced to attempt". That was not true, and the proof test could not
-- see any of the three reasons why.

-- 1. TEMPORARY is granted to PUBLIC by default, and pg_temp precedes public in
--    unqualified name resolution. The reader could therefore CREATE TEMP TABLE
--    board_member (...), insert forged rows, and have every later unqualified
--    query on that pooled connection read the forgery -- for the life of the
--    connection, persisting nothing and leaving no trace. On a product whose
--    output is financial figures shown to a board, that is the worst available
--    outcome: fabricated numbers, presented as retrieved records.
do $$
begin
  execute format('revoke temporary on database %I from public', current_database());
  execute format('revoke temporary on database %I from watchdog_reader', current_database());
  execute format('revoke temporary on database %I from watchdog_writer', current_database());
end
$$;

-- 2. The reader could read every director's password hash. `grant select on all
--    tables` is table-granular, and board_member sat inside it. Nothing in the
--    catalog path has any use for the credential table, and a prompt injection
--    that induces the agent to select from it exfiltrates the whole roster ready
--    for offline attack. The query path gets ledger data; it does not get
--    credentials.
revoke all on board_member from watchdog_reader;

-- 3. Default privileges granted the reader SELECT on every future table, which
--    would silently re-grant board_member-shaped tables as they are added. Future
--    read access becomes an explicit grant per table instead, so a table holding
--    secrets is not readable by the LLM path merely because it was created.
alter default privileges in schema public revoke select on tables from watchdog_reader;

comment on table board_member is
  'Directors who may sign in. Provisioned by an administrator; no self-service sign-up in the pilot. NOT readable by watchdog_reader: the LLM-driven query path has no business with credentials (AD-4, migration 003).';
