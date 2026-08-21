---
Status: backlog
baseline_commit:
merge_request:
---

# Story 5.1c: The actor is proved, not relayed

## Story

As **a board member**,
I want **the system to be able to prove which member a question was asked for**,
so that **holding a service token is not the same as being able to ask on anyone's behalf**.

Split from story 5.1b on 2026-08-21. That story made the association a derived value the caller
cannot choose — but it is derived **from `actorId`**, and `actorId` is a plain field in the body of
`/tools/v1/catalog/execute`. So the trust anchor moved rather than disappeared.

## What is *not* wrong, stated first

A review of 5.1b read this as "an injected agent can pass another board member's id". **It cannot**,
and starting from the wrong threat would produce the wrong design:

- `route_question(question, *, actor_id, ...)` takes the actor as a Python keyword argument threaded
  from the chat request. The model returns only `choice.name` and `choice.arguments`.
- `choice.arguments` is validated against the entry's own parameter schema
  (`additionalProperties: false`), and no entry declares an actor parameter.
- Nothing in the tool declarations handed to the model mentions an actor.
- `/chat` is token-authenticated, with a *different* token from the gateway's (AD-17).

`core/security/actor-is-never-chosen.test.ts` pins all of that, and both halves were proved by
mutation. **This story is not about the model.**

## What is actually wrong

**Anything holding a service token can name any board member.** The gateway believes `actorId`
because it arrived on an authenticated connection, not because anything proves the person behind it
consented.

Two things follow. Neither is urgent today; both get worse on the day a second association exists.

1. A leaked or misused `AGENT_SERVICE_TOKEN` reads any association's records, not just the pilot's.
   The token already grants full catalog read, so the *marginal* gain is choosing whose — which is
   exactly what story 5.1b spent itself constraining everywhere else.
2. The audit trail records `actorId` as fact. `query_log` says a named director asked a question.
   Nothing distinguishes "they did" from "something with the token said they did", and AD-12's
   record is what a board would be shown.

## Acceptance Criteria

1. **A tool request carries proof of its actor, not a claim about one.** The Next.js side mints a
   short-lived signed token binding `actorId` (and the association resolved for them); the agent
   service relays it **opaquely**, never constructing or modifying it; the gateway verifies it before
   the provenance write.

2. **A forged or altered actor claim is refused, and a test proves each.** Wrong signature, expired,
   `actorId` altered after signing, and a token minted for a different audience.

3. **The agent service cannot mint one.** It holds no signing key. A structural test asserts this,
   in the shape `core/security/no-model-in-alerts.test.ts` uses — the property is what makes the
   relay honest rather than a second place that can assert an identity.

4. **`actorId` stops being a request field it is possible to believe.** Either the gateway derives
   it from the verified token and ignores a body value, or it refuses a request that carries one —
   and a test proves which, in the shape 5.1b's `associationId` refusal already uses.

5. **The expiry window is stated and tested.** A relayed token outliving the turn it was minted for
   is a bearer credential for that member; the window is short enough that replay is bounded, and
   long enough that a slow model call does not fail a legitimate turn.

6. **AD-15 and AD-17 are amended before the code lands**, not after. Both describe a two-token
   arrangement between gateway and agent service; this adds a third credential with different
   properties — per-turn, per-actor, signed by one side and verified by the other.

## Tasks / Subtasks

- [ ] **Task 1 — The amendment.** AD-15 and AD-17, stating what the third credential is and why the
      existing two do not cover it. (AC6) **Blocked on Matt; nothing else starts until it lands.**
- [ ] **Task 2 — Mint and verify.** The signing on the Next.js side, the verification at the
      gateway, and the key's home. (AC1)
- [ ] **Task 3 — The refusals.** Forged, expired, altered, wrong audience. (AC2, AC5)
- [ ] **Task 4 — The relay is a relay.** The agent service passes the token through and holds no
      key; the structural test that says so. (AC3)
- [ ] **Task 5 — Retire the believable `actorId`.** (AC4)

## Dev Notes

### Where this sits relative to 5.1b

5.1b established that the association is derived from the actor and that no caller can supply it.
This story establishes that the *actor* is proved. Until it lands, the honest statement is: the
gateway trusts its callers, and its callers are the code we wrote plus anything holding the token.

### Sequencing, and why this is not urgent

`core/security/no-association-creation.test.ts` forbids the product from creating a second
association. While exactly one exists, choosing an actor changes *which member* a query is attributed
to, not *which records* come back. That is an audit-integrity problem rather than a confidentiality
one — real, and much smaller than the confidentiality version it becomes on the day a second
association is onboarded.

**So the ordering constraint is: this story, or the RLS work AD-4's amendment calls for, must precede
onboarding a second association.** 5.1b's creation guard is what forces that conversation.

### The mistake to avoid

Do not start from "a prompt-injected model could choose an actor". It cannot, that is pinned by a
test, and designing against it produces a control in the wrong place — inside the agent, which is the
component that would have to be trusted to apply it.

### References

- `_bmad-output/implementation-artifacts/5-1b-the-catalog-answers-for-one-association.md` — the
  derivation this rests on, and the corrected note on this threat
- `core/security/actor-is-never-chosen.test.ts` — what is already proved
- `.../ARCHITECTURE-SPINE.md` — AD-12, AD-15, AD-17
- `agent/watchdog_agent/routing.py`, `agent/watchdog_agent/chat_service.py`
- `app/tools/v1/catalog/execute/route.ts`

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
| --- | --- |
| 2026-08-21 | Split from 5.1b after a CodeRabbit finding on MR !71; the finding's stated mechanism was refuted and the real one recorded |
