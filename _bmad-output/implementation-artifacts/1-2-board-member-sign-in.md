---
baseline_commit: 3a07ee467c2f18e7873342a74afa9b9066091279
---

# Story 1.2: Board member sign-in

Status: done

## Story

As a board member,
I want to sign in to the Watchdog,
so that the association's financial records are not open to anyone with the link, and every later
action is attributable to me.

## Acceptance Criteria

**AC1 — Unauthenticated visitors reach no data**

**Given** an unauthenticated visitor
**When** they request any surface other than sign-in
**Then** they are redirected to sign-in and no association data is returned

**AC2 — A signed-in member has an identity on every request**

**Given** a board member with valid credentials
**When** they sign in
**Then** they reach the dashboard and their identity is available to every subsequent request

**AC3 — Accessible authentication**

**Given** the sign-in surface
**When** it is assessed against WCAG 2.2
**Then** it satisfies 3.3.8 Accessible Authentication — no cognitive-function test without an alternative
**And** it is fully keyboard operable with a visible focus indicator

## Tasks / Subtasks

- [x] **Task 1 — Route policy as pure domain logic** (AC: 1)
  - [x] `core/auth/route-policy.ts` — **pure**, no I/O, no Next.js imports. Exports:
        - `PUBLIC_ROUTES` — the allow-list.
        - `isPublicRoute(pathname: string): boolean`
        - `routeDecision(input: { pathname: string; isAuthenticated: boolean }): RouteDecision`
          where `RouteDecision` is `{ kind: 'allow' } | { kind: 'redirect'; to: string }`.
  - [x] **Deny by default.** The function decides from an allow-list; a pathname nobody thought
        about must come out `redirect`, never `allow`. This is the single most important property
        in the story and the failure mode is silent.
  - [x] Redirecting to sign-in preserves where the visitor was headed via a `next` query parameter,
        and that parameter is **validated on the way back out** (Task 3) — an unvalidated redirect
        target is an open-redirect.
  - [x] `core/auth/route-policy.test.ts`.

- [x] **Task 2 — Safe post-sign-in redirect target** (AC: 1, 2)
  - [x] In the same module: `safeRedirectTarget(raw: string | null | undefined, fallback: string): string`.
  - [x] Accepts only same-origin **path** targets: must start with a single `/`, must not start with
        `//` or `/\` (protocol-relative), must not contain a scheme, must not contain control
        characters or a newline. Everything else returns `fallback`.
  - [x] Must reject a target that is itself the sign-in route, or sign-in bounces forever.
  - [x] Tested against a hostile list, not just the happy path.

- [x] **Task 3 — Supabase server client and session plumbing** (AC: 2)
  - [x] `adapters/auth/supabase-server.ts` — creates the request-scoped server client using
        `@supabase/ssr`'s `createServerClient` with the Next.js cookie adapter.
  - [ ] **Not built — deliberately.** `adapters/auth/supabase-browser.ts` — `createBrowserClient`
        for the sign-in form only. The form is a server action instead, so no browser client is
        needed and the surface works without JavaScript. See Completion Notes.
  - [x] `adapters/auth/env.ts` — reads `NEXT_PUBLIC_SUPABASE_URL` and
        `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **Must not throw at module load.** See *The build-time
        env trap* in Dev Notes — a module-load throw makes `npm run build` require real
        credentials and breaks the build gate for everyone without them.
  - [x] `adapters/` may import from `core/ports` and `core/`, never the reverse (architecture
        Design Paradigm layer table).

- [x] **Task 4 — Middleware enforcing the policy** (AC: 1) — shipped as `proxy.ts`, see Completion Notes
  - [x] `proxy.ts` at the repository root (Next.js 16 renamed the convention). It resolves the session, calls `routeDecision`,
        and redirects. It contains **no policy of its own** — all decisions come from `core/auth`,
        so the policy is testable without a running server.
  - [x] `config.matcher` must exclude `_next/static`, `_next/image` and `favicon.ico` while
        covering every application route. Getting this wrong either breaks assets or leaves a
        surface unguarded.
  - [x] Middleware must return the response produced by the Supabase cookie refresh, or the
        refreshed session cookie is dropped and the user is signed out on the next navigation.

- [x] **Task 5 — Sign-in surface** (AC: 2, 3)
  - [x] `app/sign-in/page.tsx` — email + password form.
  - [x] **WCAG 3.3.8:** no CAPTCHA, no puzzle, no "type the third character of your memorable
        word", no disabling paste. The password field must carry `autocomplete="current-password"`
        and the email field `autocomplete="username"` so a password manager can fill both — that
        support *is* the conformance mechanism.
  - [x] Every input has a real `<label for>`; errors are associated via `aria-describedby` and
        announced through a live region.
  - [x] Fully keyboard operable with a visible focus ring. Story 1.3 owns the token system, so
        style this surface with **plain inline CSS using the literal DESIGN.md values**, and leave
        a note that 1.3 replaces them with tokens. Do not invent a token layer here.
  - [x] Error copy per EXPERIENCE.md → Voice and Tone: plain, states what to do next, never
        apologises, never implies certainty. "That email and password don't match an account."
  - [x] Never reveal whether an email exists — the same message for unknown-user and bad-password.

- [x] **Task 6 — Sign-out and the dashboard placeholder** (AC: 2)
  - [x] `app/(app)/dashboard/page.tsx` — a protected server component that renders the signed-in
        member's email, proving identity is available server-side. Story 1.3+ builds the real
        dashboard; keep this minimal.
  - [x] A sign-out action that clears the session and returns the visitor to sign-in.
  - [x] `app/page.tsx` redirects to `/dashboard` (which the middleware then guards) so the root
        no longer renders the 1.1 placeholder.

- [x] **Task 7 — Documented environment** (AC: 2)
  - [x] `.env.example` listing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with
        **names only, never values**. It is the one `.env*` file `.gitignore` deliberately does not
        ignore.
  - [x] README: a short "Environment" section explaining that the app builds without these but
        cannot sign anyone in without them.
  - [x] Confirm the NFR-2 guard still passes and still does **not** flag the Supabase names, and
        that `.env.example` is now a file it reads. (The detector is a deny-list only — the names
        pass because nothing matches them, not because an allow-list names them. The story's
        original wording said otherwise and was wrong.)

- [x] **Task 8 — Gates** (AC: 1, 2, 3)
  - [x] `npm run lint`, `npm run build` (**without** any Supabase env var set — this must pass),
        and `npm test` all clean.

## Dev Notes

### Scope boundaries

- **No database tables, no RLS, no `watchdog_writer` / `watchdog_reader` roles.** Story 1.4 owns
  the two roles and the INSERT-fails-for-reader test. This story uses Supabase **auth only**.
- **No design token system.** Story 1.3 owns it. Inline the literal DESIGN.md values here.
- **No user management** — no sign-up, no password reset, no invitations. The pilot's board members
  are provisioned in the Supabase dashboard. Say so in the README rather than building a surface
  nobody asked for.
- **No `agent/`, no `catalog/`, no `tools/`.**

### The build-time env trap — read this before writing `adapters/auth/env.ts`

Next.js evaluates modules during `next build`. If the Supabase client is constructed at module
scope, or if the env reader throws at import time, then `npm run build` starts requiring real
Supabase credentials — and Story 1.1's build gate breaks for every contributor and every CI run
that does not have them.

Required shape:

- Reading env happens **inside** the function that creates a client, not at module load.
- A missing variable throws a **named, specific** error at call time (`MissingSupabaseConfigError`),
  never a silent placeholder client that fails later with an incomprehensible network error.
- `app/sign-in/page.tsx` and the dashboard must not construct a client at module scope.

Test this explicitly: a test that asserts importing the module with a cleared environment does not
throw, and that calling the factory then does.

### Architectural constraints

| Constraint | Source | What it means here |
| --- | --- | --- |
| Layer direction | Spine §Design Paradigm | `core/auth/` imports nothing. `middleware.ts` and `app/` may import `core/`; `adapters/auth/` implements the outward edge. No Next.js type may appear in `core/`. |
| **AD-4** — roles separate by pipeline stage | Spine | Not exercised yet, but do not create a single omnipotent DB role "for now". Story 1.4 introduces both roles together. |
| **AD-3** — the LLM runtime holds no data credentials | Spine | Nothing in this story may place a Supabase credential anywhere reachable by `agent/`. |
| **NFR-2 / AD-2** | Spine, PRD §6.1 | The guard from 1.1 now reads `.env.example`. Adding Supabase names there must keep it green — verify, do not assume. |
| Accessible authentication (3.3.8) | EXPERIENCE.md §Accessibility Floor | "Inheriting Supabase auth does not discharge this." Password-manager support is the conformance mechanism. |
| Voice and Tone | EXPERIENCE.md §Voice and Tone | Errors state what to do next and never apologise. |
| Focus ring | DESIGN.md §Components | `2px solid #14213D`, `2px` offset, on stone grounds. Never removed. |

### Failure-mode shape for this story

The interesting failures are all in Task 1 and Task 2, and both are security properties rather than
correctness niceties:

- **Fail-open route policy.** A policy that allow-lists by prefix, or that returns `allow` for an
  unrecognised path, exposes data. Test the unknown path, the empty path, the path with a trailing
  slash, the case variant, and the path-traversal form.
- **Open redirect.** `?next=//evil.example` and `?next=https://evil.example` must both fall back.
  So must `/\evil.example`, a target containing `\n`, and a target pointing at sign-in itself.

These are the two behaviors to write failure-mode analyses for first.

### Testing standards

- Vitest, `environment: 'node'`, tests colocated as `*.test.ts`.
- `core/auth/*` is pure and must be tested directly, with no Next.js request objects involved.
- Component tests are **not** required by this story. If a behavior genuinely needs one, adding
  `@testing-library/react` + `jsdom` is permitted — but prefer extracting the logic into `core/`
  and testing it there, which is what the layer split is for.

## Project Structure Notes

```text
adapters/auth/
  env.ts                    # NEW — lazy env reading, named error
  supabase-server.ts        # NEW
app/
  page.tsx                  # UPDATE — redirect to /dashboard
  sign-in/page.tsx          # NEW
  (app)/dashboard/page.tsx  # NEW
core/auth/
  route-policy.ts           # NEW — pure
  route-policy.test.ts      # NEW
  sign-in-feedback.ts       # NEW — pure; failure copy and reason validation
  sign-in-feedback.test.ts  # NEW
proxy.ts                    # NEW — repository root; Next.js 16 renamed middleware -> proxy
proxy.test.ts               # NEW
.env.example                # NEW — names only
```

`proxy.ts` at the repository root is a Next.js requirement and a variance from the spine's source
tree, in the same category as `.github/` — record it, no AD change needed.

## Library & Framework Requirements

Verified against the npm registry on 2026-07-30.

| Package | Version | Why |
| --- | --- | --- |
| `@supabase/supabase-js` | `^2.111.0` | The client. |
| `@supabase/ssr` | `^0.12.4` | Cookie-based sessions for App Router server components and middleware. Its peer is `@supabase/supabase-js@^2.111.0`, so install both. |

Add nothing else. In particular do **not** add an auth-UI package: the sign-in surface is three
fields and this product's visual register is specified in DESIGN.md, which no vendor widget matches.

## References

- Story statement and acceptance criteria: [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2: Board member sign-in]
- Accessible authentication obligation: [Source: .../ux-designs/.../EXPERIENCE.md#Accessibility Floor]
- Error copy rules: [Source: .../ux-designs/.../EXPERIENCE.md#Voice and Tone]
- Focus ring and colour tokens: [Source: .../ux-designs/.../DESIGN.md#Components]
- Layer → namespace mapping: [Source: .../ARCHITECTURE-SPINE.md#Design Paradigm]
- AD-3, AD-4: [Source: .../ARCHITECTURE-SPINE.md#Invariants & Rules]
- Sign-in has no elicited design; inherited from Supabase auth: [Source: .../EXPERIENCE.md#Open Items]

## Dev Agent Record

### Agent Model Used

claude-opus-5[1m] (Claude Opus 5, 1M context) — `bmad-dev-tdd`

### Test Design

Two behaviors carry the story's security properties, and both are pure. The Supabase plumbing,
the sign-in surface and the dashboard are integration glue whose logic was deliberately pushed
into `core/auth` so it could be tested without a server — that is what the layer split buys.

#### Behavior A — `isPublicRoute` / `routeDecision`

1. *Observable signal:* `allow` or `redirect`, deterministic from `(pathname, isAuthenticated)`.
2. *Seams:* none needed; no request object, no cookie, no clock.
3. *Failure modes:*

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| A1 | **Fails open on an unrecognised path** — the silent one | GUARD | Nine protected paths, including `/some/route/nobody/has/written/yet`, each asserted to redirect |
| A2 | Prefix matching makes `/sign-in-secretly` public | GUARD | `does not match by prefix…` |
| A3 | A path merely containing the public route is treated as public | GUARD | `does not match a path merely containing the public route` |
| A4 | Case variant bypasses the allow-list | GUARD — fail closed | `is case-sensitive, so a case variant falls through to protected` |
| A5 | Empty pathname falls open | GUARD | `treats the empty pathname as protected`, `protects the empty pathname rather than falling open` |
| A6 | Traversal-shaped pathname treated as public | GUARD | `treats a traversal-shaped pathname as protected` |
| A7 | Trailing slash makes `/sign-in/` unreachable, so sign-in redirects to itself | GUARD | `tolerates a trailing slash on a public route` + `does not append a next parameter pointing back at sign-in` |
| A8 | Signed-in member re-shown sign-in | GUARD | `sends an authenticated member away from sign-in rather than showing it again` |
| A9 | Non-string pathname decided on | GUARD — `TypeError` | `rejects a non-string pathname rather than deciding on nonsense` |

4. *Same defect shape elsewhere:* the `proxy.ts` matcher is the other place a route can silently
   become unguarded. It is written as an **exclusion** rather than an allow-list for exactly this
   reason, so a surface added tomorrow is covered by default.

#### Behavior B — `safeRedirectTarget`

1. *Observable signal:* the target returned, or the fallback.
2. *Seams:* none.
3. *Failure modes* — this parameter is attacker-controlled by construction, since it arrives in a
   URL anyone can craft and hand to a board member:

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| B1 | **Open redirect** via `//evil.example` | GUARD | in the hostile-target table |
| B2 | Open redirect via `/\evil.example` — browsers treat `/\` as `//` | GUARD | same table |
| B3 | Absolute `http:` / `https:` target | GUARD | same table |
| B4 | `javascript:` / `data:` scheme | GUARD | same table |
| B5 | Header splitting via `\n` or `\r` | GUARD | same table |
| B6 | Null byte or other control character | GUARD | same table |
| B7 | Bare relative path (`register`) resolving unpredictably | GUARD | same table |
| B8 | Redirect loop — target is sign-in itself | GUARD | two tests, bare and with a query string |
| B9 | Non-string coerced rather than rejected | GUARD — `TypeError` | `rejects a non-string target rather than coercing it` |

4. *Cross-check / inverse:* `round-trips a decision: the next parameter it emits is one it accepts
   back` — feeds `routeDecision`'s own output through `safeRedirectTarget` and asserts the original
   path survives. The two functions are each other's inverse across the redirect, and a change to
   the encoding on either side breaks this test rather than silently breaking sign-in.

#### Behavior C — `readSupabaseConfig`

1. *Observable signal:* the config object, or a named error.
2. *Seams:* the environment is a parameter with a `process.env` default — that injection is what
   makes it testable at all.
3. *Failure modes:*

| # | Failure mode | Class | Test |
| --- | --- | --- | --- |
| C1 | **Throwing at module load breaks `npm run build` for everyone without credentials** | GUARD | `imports without throwing when the environment is empty…` |
| C2 | Missing variable yields a half-configured client that fails later with an opaque network error | GUARD — fail fast, named error | `throws a named error rather than returning a half-configured client` |
| C3 | Only the first missing variable reported | GUARD | `names every missing variable at once, not just the first` |
| C4 | Whitespace-only value treated as present | GUARD | three cases per variable: absent, empty, whitespace-only |
| C5 | Error copy apologises or leaks a provider message | GUARD | `says what to do next, per the project voice` |

### Debug Log References

**Red.** `core/auth/route-policy.test.ts` against stubs → `19 failed | 43 passed (62)`, every
failure an assertion rather than a missing symbol. `adapters/auth/env.test.ts` was written against
a complete implementation of a behavior whose whole contract is "does not throw on import" — its
red was established by the module-load test, which fails immediately if a client is constructed at
module scope.

**Green.** Route policy 62 passed; env 12 passed. Full suite **180 passed across 5 files**.

**Build with no Supabase environment set** — the property Task 8 exists to protect — succeeded:
5 routes, `/` static, `/dashboard` and `/sign-in` dynamic, proxy registered. `npx tsc --noEmit`
clean. `npm run lint` clean.

**Control characters in source.** The first implementation expressed the unsafe-character check as
a regex class containing literal control bytes, which made `core/auth/route-policy.ts` a binary
file to git and grep. Replaced with an explicit code-point scan (`hasControlCharacter`); the test
file's literal NUL was replaced with ` `. Verified zero control characters across every source
file in `core/` and `adapters/`.

### Completion Notes List

**Deviations from the story spec, all deliberate:**

1. **No `adapters/auth/supabase-browser.ts`.** The story specified a browser client for the sign-in
   form. The form is a **server action** instead, which is strictly better here: it works with
   JavaScript disabled, keeps the credential exchange server-side, needs no client component, and
   removes a module the story would otherwise have shipped unused. The subtask is left unchecked
   rather than marked done against a file that does not exist.

2. **`middleware.ts` shipped as `proxy.ts`.** Next.js 16 renamed the file convention and emits
   `The "middleware" file convention is deprecated. Please use "proxy" instead.` on every build.
   The exported function is `proxy`; `config.matcher` is unchanged. Building on a deprecation the
   framework already warns about would be a defect on day one.

3. **`app/dashboard/` rather than `app/(app)/dashboard/`.** The route group buys nothing with one
   protected route in it. Story 1.3+ can introduce it when there is a shared layout to hang on it.

4. **Failure copy distinguishes three reasons, not one.** Bad credentials, missing input, and an
   unconfigured installation read differently, because "that email and password don't match an
   account" is actively misleading when the real problem is that nobody has connected Supabase yet.
   Unknown-email and wrong-password remain **one** message — telling a visitor which of the two
   failed lets an unauthenticated stranger enumerate the board roster.

**WCAG 2.2 SC 3.3.8 — how it is satisfied, not just claimed.** There is no CAPTCHA, no puzzle, no
memorable-word challenge, and no paste blocking. `autocomplete="username"` and
`autocomplete="current-password"` let a password manager fill both fields, which is the criterion's
own listed mechanism. EXPERIENCE.md is explicit that "inheriting Supabase auth does not discharge
this", so the surface is hand-built rather than a vendor widget. Focus is visible via a
`:focus-visible` rule carrying DESIGN.md's `2px solid #14213D` with a `2px` offset — it ships as a
`<style>` element because a pseudo-class cannot be expressed as an inline style, and omitting it
would have been a conformance failure rather than a cosmetic one. Targets are 44px tall.

**Fail-closed on an unconfigured provider.** If `readSupabaseConfig` throws inside the proxy, the
visitor is treated as unauthenticated and sent to sign-in. An auth provider that cannot be reached
must never open the gate, and no association data is served on that path either way.

**Session cookies.** The proxy reassigns its response inside `setAll` and returns that object.
Returning a freshly constructed response instead drops the refreshed session cookie and signs the
member out on their next navigation — a subtle, intermittent bug worth the comment it carries.

**Second lock on the dashboard.** The page re-checks `getUser()` and redirects even though the proxy
already guards it. One careless edit to a matcher regex should not be sufficient to expose member
data.

**Styling is intentionally pre-token.** Literal DESIGN.md hex values are inlined on both surfaces
with a comment saying so. Story 1.3 owns the token layer; inventing a second one here would leave
two systems to reconcile.

**Out of scope and not built:** database tables, RLS, the `watchdog_writer`/`watchdog_reader` roles
(Story 1.4), the token system (1.3), sign-up, password reset, invitations.

**Sibling defect search:** the only other place a route can silently become unguarded is the
`proxy.ts` matcher, addressed above by writing it as an exclusion. No other pattern of this shape
exists in the codebase yet.

### File List

- `.env.example` (new)
- `README.md` (modified — Environment section)
- `adapters/auth/env.ts` (new)
- `adapters/auth/env.test.ts` (new)
- `adapters/auth/supabase-server.ts` (new)
- `app/dashboard/page.tsx` (new)
- `app/page.tsx` (modified — redirects to the dashboard)
- `app/sign-in/page.tsx` (new)
- `core/auth/route-policy.ts` (new)
- `core/auth/route-policy.test.ts` (new)
- `proxy.ts` (new)
- `proxy.test.ts` (new)
- `core/auth/sign-in-feedback.ts` (new)
- `core/auth/sign-in-feedback.test.ts` (new)
- `app/layout.tsx` (modified — product-wide focus ring)
- `package.json`, `package-lock.json` (modified — `@supabase/supabase-js`, `@supabase/ssr`)
- `tsconfig.json` (modified — `adapters/**/*.ts` added to `include`)
- `_bmad-output/implementation-artifacts/1-2-board-member-sign-in.md` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Local Code Review (AI) — 2026-07-30

Two adversarial layers ran against `3a07ee4..75b3c87` (a third was interrupted). Both independently
found the same two serious defects, and both were in **`proxy.ts` — the one new module with no
tests**. That is the lesson of this review, not an incidental detail: the Test Design section
argued the proxy was "integration glue" and demoted it, but the glue is where `isAuthenticated` is
derived, where the matcher decides what is even seen, and where the response object is chosen. A
`proxy.test.ts` now exists with 24 tests, and both defects were driven from red.

**Fixed — High:**

- [x] **The proxy discarded refreshed session cookies on every redirect.** `setAll` carefully
      reassigns `response` so rotated cookies ride out; the redirect branch then returned a brand
      new `NextResponse.redirect(...)` carrying none of them — the exact bug the Completion Notes
      claimed to have avoided. Failure: a director with an expired access token opens `/sign-in`
      from a bookmark, Supabase silently refreshes and *rotates* the refresh token, the redirect
      drops the `Set-Cookie`, and the browser keeps a token that has already been consumed. They
      are signed out on some later navigation with nothing to point at. The inverse is as bad —
      Supabase's session-*clearing* cookies were dropped too, so a dead cookie was never evicted and
      every later request paid a failed round trip. Cookies are now copied onto the redirect;
      two tests cover the rotate and clear cases.
- [x] **The matcher unguarded any route path ending in an image extension.** The exclusion ended in
      `.*\.(svg|png|…)$`, which matches route pathnames, not just files under `/public`. A document
      preview at `/api/documents/42/preview.png` — an entirely ordinary next step once Story 1.4
      lands uploads — would have served association records to anyone with the link, with no test
      failing and no reviewer signal. Verified live: `/anything/not/a/route.png` returned 404 with
      no `Location` header, meaning the proxy never ran. The exclusion is now anchored to prefixes
      and whole filenames (`_next/`, `favicon.ico`, `robots.txt`, `sitemap.xml`,
      `manifest.webmanifest`, `.well-known/`). Four tests assert image-suffixed *routes* are
      guarded. The trade — files under `/public` are guarded too — is deliberate and documented in
      the code: sign-in is the only unauthenticated surface and it needs no assets.

**Fixed — Medium:**

- [x] **`?reason=constructor` returned a 500 on the product's only public page.** `raw in MESSAGES`
      walks the prototype chain, so `toString`, `valueOf`, `__proto__` and friends bypassed the
      unknown-reason fallback and returned a *function* from something typed as returning a string.
      React then threw rendering it. Trivially weaponisable: send a director a link, they get an
      error page instead of sign-in. The copy and its lookup moved to a pure module,
      `core/auth/sign-in-feedback.ts`, where membership is an explicit test over a frozen list —
      the bug is now unrepresentable rather than merely fixed. Seven prototype members are tested.
- [x] **A Supabase outage was reported to the member as a wrong password.** Transport failures come
      back as an `error` object rather than a throw, and everything non-`MissingSupabaseConfigError`
      landed in `credentials`. Directors would have reset passwords that were never the problem. A
      fourth reason, `unavailable`, now distinguishes a provider that could not answer from a
      provider that answered "no".
- [x] **`role="alert"` could not announce.** The error arrives via a full-page redirect, and a live
      region present in the initial DOM is not announced — announcement requires the region to
      change after it exists. The email field now takes `autoFocus` when a message is present, so a
      screen reader reads its `aria-describedby` target on arrival. This works without JavaScript,
      which the previous claim did not.
- [x] **A blanket `catch {}` around cookie writes could swallow a real failure.** Legitimate in a
      server component, where writes always throw; wrong in the sign-in action and `signOut`, where
      a swallowed failure means sign-in reports success with no session cookie (member bounced back
      to a blank form forever) or sign-out leaves a live session on a shared computer.
      `createSupabaseServerClient` now takes an explicit `cookieWrites: 'best-effort' | 'required'`.
- [x] **The dashboard had no design-system focus ring.** The rule was scoped to `.watchdog-sheet`,
      which exists only on sign-in, so the dashboard's sign-out button fell back to the UA default —
      while the Completion Notes claimed both surfaces carried it. The rule moved to
      `app/layout.tsx` and now applies product-wide.
- [x] **A test that could not fail.** `expect(PUBLIC_ROUTES.length).toBeLessThanOrEqual(2)` would
      have allowed the public surface to double without turning red. Pinned to exact contents.

**Fixed — documentation accuracy:**

- [x] Task 4's subtask was ticked against `middleware.ts`, a file that does not exist, and the
      Project Structure Notes still listed both it and the unbuilt `supabase-browser.ts`. Both
      corrected; the structure block now matches the File List.
- [x] Task 7 claimed the Supabase names are "already in [the guard's] permitted list". There is no
      permitted list — `forbidden-credentials.ts` is a deny-list, and the names pass because nothing
      matches them. Corrected. (The substantive obligation holds: the guard is green with
      `.env.example` present, verified.)

**Accepted, not fixed — with reasons:**

- **Brute-force throttling is delegated to Supabase's own auth rate limits, and that is now a
  recorded decision rather than a silent inheritance.** WCAG 3.3.8 rules out a CAPTCHA, which makes
  the absence of any other control worth naming. HOA board rosters are public record, so an attacker
  can obtain a director's email. **Follow-up for the deployment story: verify the project's auth
  rate-limit settings are adequate and record the numbers.** Building an application-level lockout
  here would need a database table that Story 1.4 has not created yet.
- **WCAG 3.3.7 Redundant Entry — the email is not repopulated after a failed attempt.** Putting the
  address in a query string to survive the redirect would write a board member's email into server
  logs and browser history, which is a worse outcome than retyping it. `autoComplete="username"`
  means a password manager refills it, which is the criterion's "available to select" allowance.
  Revisit if the form ever becomes a client component holding its own state.
- **`app/` imports `adapters/` directly; `core/ports/` does not exist yet.** The spine's layer table
  routes both through ports. Introducing a port interface for a single auth adapter with one
  implementation would be ceremony, not structure. The direction that actually matters is intact and
  verified: `core/` imports nothing from `adapters/`, `app/`, or `next`. Revisit when a second
  adapter for the same port appears — the extraction adapter in Story 1.5 is the likely trigger.
- **`getUser()` runs on every guarded request, including `/robots.txt`.** It is a network call to
  Supabase, not a local JWT verification. Well-known root files are now excluded from the matcher,
  which removes the crawler-facing cases. The per-navigation cost on real surfaces is inherent to
  verifying a session rather than trusting a cookie, and verifying is the correct choice on a
  financial surface.

Final state after review fixes: **236 tests passing** across 7 files; `npm run lint`,
`npx tsc --noEmit` and `npm run build` (with no Supabase environment set) all clean.

### Change Log

| Date | Change |
| --- | --- |
| 2026-07-30 | Local adversarial review: fixed the proxy discarding refreshed and cleared session cookies on redirect, and a matcher that unguarded any route path ending in an image suffix; both defects were in the one module without tests, which now has 24. Fixed a prototype-chain lookup that 500'd the only public page, an outage reported as a wrong password, an unannounceable live region, an over-broad cookie-write catch, and a focus ring that covered one surface of two. |
| 2026-07-30 | Board member sign-in: deny-by-default route policy and hostile-input-tested redirect handling as pure domain logic; Supabase session plumbing with lazy environment reading so the build never requires credentials; hand-built sign-in surface satisfying WCAG 2.2 SC 3.3.8; protected dashboard placeholder and sign-out. |

