# Test Design Reference

The authority for **what tests to write** in this workflow.

Use it in two places:

- **Step 5** — the four Questions to Ask, to enumerate failure modes before writing anything
- **Step 6** — Turn those failure modes into a concrete test list

---

## General Principles

- **Test anything that might break.** Not every line — every thing that can break.
- **Test everything that does break.** A defect that escaped is a missing test. Reproduce it with a failing test before fixing it, always.
- **New code is guilty until proven innocent.** Untested code is assumed broken.
- **Write at least as much test code as production code.** If the ratio is far below that, the test list is thin.
- **Run local tests on every change.** Not at the end of the task — continuously.
- **Run all tests before handing work off.** The full suite, not the file you were editing.

---

## Questions to Ask (Step 5 — before any code exists)

Answer all four in writing, per behavior:

1. **If the code ran correctly, how would I know?**
   Name the observable signal — a return value, a state change, a message sent, a row written. If nothing is observable, the behavior has no testable contract; give it one before proceeding.

2. **How am I going to test this?**
   Identify the seams: what must be injected, faked, or passed in (clock, random source, filesystem, network client, database). If the honest answer is "I can't test this without spinning up the world," the design is wrong. Change the design now — extract the pure decision from the I/O, inject the collaborator, return a value instead of mutating a global.

3. **What else can go wrong?**
   The failure-mode list. Push past the happy path and past "null input." See the prompts below.

4. **Could this same kind of problem happen anywhere else?**
   Defects have shapes, and shapes repeat. When you find one, search for its siblings in the codebase and report them.

### Failure-mode prompts

Work these prompts for each behavior; they generate the primary failures worth guarding:

- **Input** — absent, empty, blank, zero, negative, oversized, wrong type, wrong encoding, duplicate, adversarial (injection, path traversal, hostile size)
- **Collaborators** — every external call fails, times out, returns nothing, returns garbage, returns slowly, or succeeds twice
- **State** — the behavior is called before initialization, twice, out of order, after teardown, or concurrently with itself
- **Arithmetic and conversion** — division by zero, overflow, precision loss, rounding direction, unit and timezone mismatch, locale-dependent parsing
- **Resources** — handles leaked on the error path, connections not returned, locks not released, unbounded growth
- **Partial failure** — the behavior throws midway: what is left half-written, and can it be recovered from?

Classify each finding:

| Class | Meaning | Test obligation |
| --- | --- | --- |
| **GUARD** | The code must detect and handle it | A test that forces the condition and asserts the handled outcome |
| **PROPAGATE** | The code must let it escape, with a defined contract | A test asserting the specific error type/message escapes uncaught |
| **OUT-OF-SCOPE** | Deliberately not handled here | No test; record why, and where it _is_ handled |

An unclassified failure mode is an unfinished analysis.

---

## What to Test (Step 6 — deriving the test list)

For every behavior, walk all six in order. Write the "Right" test first, then work outward.

### Right — can the results be verified

The ordinary, expected case, with realistic inputs. One clear assertion of the contract. If you cannot state what "right" means for this behavior in one sentence, stop and clarify the requirement.

### Boundary conditions — are they all met?

The single richest source of real defects. Apply each dimension and keep the ones that apply:

- **Format.** Does the value conform to an expected format? Email addresses, ISO dates, URLs, currency codes, JSON shape, file extensions, ID formats. Test the malformed-but-plausible cases, not just gibberish: a date of `2026-02-30`, a URL with no scheme, a JSON body missing one required key.
- **Parameters.** Is the set of values ordered or unordered as appropriate? Sort stability, pagination order, insertion order preserved or not, events processed out of sequence, results returned in an order the caller depends on but the contract never promised.
- **Value limits.** Is the value within reasonable minimum and maximum values? Test at the boundary and one step past it on both sides: `min-1, min, min+1, max-1, max, max+1`. Include type limits (integer overflow), domain limits (a percentage of 101, an age of -1), and collection size limits.
- **External references.** Does the code reference anything outside its own control? External state, a global, a file that must exist, a service that must be reachable, a row that must be present, a prior method that must have been called. Each such reference is a precondition — test what happens when it is not met.
- **Null / absent.** Does the value exist at all? Null, undefined, empty string, empty collection, zero, missing key, absent optional, record not found, file not present. Distinguish "absent" from "present but empty" — they are different tests and often different bugs.
- **Zero, one, or too many.** Are there exactly enough values? The zero-one-many rule: test with none, exactly one, exactly the boundary count (the "fencepost" case), and more than the maximum. Off-by-one errors live here.
- **Order and time.** Is everything happening in order, at the right time, and in time? Relative ordering (A must precede B), absolute time (expiry, scheduling, DST transitions, leap days, timezone conversion), and timeouts. Time-dependent code must take its clock as a parameter — otherwise the test is not Repeatable.

### Reverse it

Apply the inverse operation and assert you get the original back: serialize→parse, encrypt→decrypt, insert→read, compress→decompress, encode→decode, `sqrt(x)²≈x`. Cheap, and it catches whole classes of transformation defects that example-based tests miss.

### Cross check

Verify the result a second, independent way: a known-good library, an obviously-correct but slow implementation, a different data source that must agree, a conservation property (the parts sum to the whole; nothing was created or lost). Especially valuable when the production algorithm is optimized and therefore hard to eyeball.

### Force the error states

**This is where defensive code comes from.** Every GUARD and PROPAGATE failure mode from Step 5 needs a test that actually makes it happen — not a test that assumes it. Force it with fakes and stubs: throw from the injected collaborator, return a truncated response, return an empty result set, exhaust the retry budget, feed a hostile payload. Assert both the outcome and the absence of collateral damage (no partial write, no leaked handle, no swallowed error).

If a failure mode cannot be forced, the code lacks a seam. Add the seam.

### Any performance concerns

Assert bounds **only when the story or Dev Notes states one.** When it does, test the property that will actually break — the complexity class or the query count — rather than a wall-clock number that will make the suite flaky on other machines. Prefer "issues exactly one query per request" or "handles 10× input without quadratic growth" over "completes under 200ms."

---

## Good Tests Are reliable (Step 6 — quality gate on each test)

A test that fails any of these is a liability. Fix it or delete it.

- **A — Automatic.** Runs with no human intervention: no manual setup, no prompt, no eyeballing console output. It asserts, and it self-reports pass or fail.
- **T — Thorough.** Covers the derived list, not just the case you happened to think of first. Every boundary that applies, every GUARD failure mode.
- **R — Repeatable.** Same result every run, in any environment, in any order. No real clock, no unseeded randomness, no network, no shared mutable fixture, no dependence on leftover state from a previous test. Inject anything nondeterministic.
- **I — Independent.** One test verifies one thing, and passes alone as well as in a suite. No test may depend on another test having run first. When a test fails, its name alone should tell you what broke.
- **P — Professional.** Test code is production code: named for behavior and condition (`rejects_withdrawal_when_balance_below_amount`), free of copy-paste drift, refactored, and reviewed to the same standard as the code it guards.

---

## Defensive Coding Follows the Tests

Order matters — the test comes first, then the guard it justifies. Prefer earlier options:

1. **Make the failure unrepresentable.** Narrow the type, forbid the null, make the invalid state unconstructable. A whole category of tests becomes unnecessary because the compiler or the type now enforces it.
2. **Guard at the boundary.** Validate untrusted input once, at the edge — the public API, the deserializer, the request handler — so interior code can trust what it receives. Redundant interior checks add noise, not safety.
3. **Fail fast and loudly.** On a violated precondition, raise a specific, named error immediately. Never continue with a degraded value, never silently coerce, never catch an exception into a default that hides the fault from the caller.
4. **Leave no partial state.** A behavior that throws midway must not leave the system half-updated. Do the fallible work before the mutation, or make the mutation reversible.

**A guard with no test behind it is a guess.** If you are writing one, you skipped a failure mode — go back and add it.
