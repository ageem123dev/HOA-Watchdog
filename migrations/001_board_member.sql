-- Board members: who may sign in.
--
-- The pilot is one association and a handful of directors, provisioned by an
-- administrator. There is deliberately no sign-up, no password reset and no
-- invitation flow -- see the README.

create table board_member (
  id            uuid primary key default uuidv7(),
  email         text        not null,
  password_hash text        not null,
  display_name  text,
  -- A member who leaves the board keeps their audit trail and loses access.
  -- Nulled rather than deleted: rows elsewhere reference who did what, and a
  -- fiduciary record that loses its actor is worth less than one that keeps it.
  disabled_at   timestamptz,
  created_at    timestamptz not null default now(),

  -- Sign-in lower-cases the address before looking it up (core/auth/authenticate.ts).
  -- Enforcing the same shape here makes a mixed-case row unrepresentable rather
  -- than merely unlikely -- otherwise it is insertable and then never matches.
  constraint board_member_email_is_lowercase check (email = lower(email)),
  constraint board_member_email_length check (char_length(email) between 3 and 254),
  constraint board_member_email_shape check (email like '%_@_%'),
  -- Every hash this system writes is scrypt in the format core/auth/password.ts
  -- produces. A row in any other format would silently fail every sign-in.
  constraint board_member_password_hash_format check (password_hash like 'scrypt$%'),
  constraint board_member_email_unique unique (email)
);

comment on table board_member is
  'Directors who may sign in. Provisioned by an administrator; no self-service sign-up in the pilot.';
comment on column board_member.disabled_at is
  'Set to revoke access while preserving the audit trail. Note: sessions are JWT, so an existing session survives until it expires (see AD-15 correction in the architecture spine).';
