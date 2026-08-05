#!/usr/bin/env python3
"""List the test cases a diff touched, so the test-value pass has a checklist.

A fix diff changes production code and tests together, and the tests are the
half nobody re-reads. Two defects hide there, and only one of them is
mechanically detectable:

  vacuous          passes whether or not the code is right -- a mutation finds it
  expired premise  asserts what a *later* decision made wrong -- a mutation does
                   NOT find it, because such a test is strongly sensitive: break
                   the code and it fails loudly. It looks like the best test in
                   the suite.

Story 1.5d shipped two expired-premise tests in a row, both asserting "releases
the claim so a retry need not wait" -- true when written, wrong once a retry
cooldown existed, and each one blocked the fix it should have driven.

This script does not judge. It prints what to judge, so the pass is over a list
rather than over memory.

**It must never drop a case in silence.** A checklist that quietly omits an
entry is worse than no checklist, because it reads as coverage. Two rules follow
from that, and both were written after a review found the script breaking them:

  - Err toward listing too much. A case owns every line from its declaration to
    the next, so inserting a test directly after another flags the untouched
    neighbour too. A spurious entry costs one re-read; a missing one costs the
    defect this step exists to catch.
  - Anything unparseable is *reported* as unparseable. The regex cannot handle
    every shape a declaration can take, so whatever it fails to parse is printed
    under UNPARSED rather than vanishing.

Usage:
    python3 _bmad/scripts/tests_touched.py <git-range> [--] [<pathspec>...]
    python3 _bmad/scripts/tests_touched.py HEAD~1..HEAD
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

TEST_FILE = re.compile(r"\.(test|spec)\.(ts|tsx|js|mjs)$")

DEFAULT_PATHSPEC = [
    # Kept in step with TEST_FILE above. They disagreed once: the regex accepted
    # .js and .mjs while the pathspec asked git only for .ts and .tsx, so a
    # JavaScript test file was never even fetched. Raised in review.
    "*.test.ts",
    "*.test.tsx",
    "*.test.js",
    "*.test.mjs",
    "*.spec.ts",
    "*.spec.tsx",
    "*.spec.js",
    "*.spec.mjs",
]

# `it('...')`, `it.each([...])('...')`, `test(...)`, `it.skip.each(...)`.
#
# Matched over the whole file rather than line by line, because `it.each` takes a
# table that routinely spans lines and a per-line match cannot see the title that
# follows it.
#
# The argument group tolerates one level of nested parentheses. A non-greedy
# `\(.*?\)` stopped at the first `)`, so `it.each(build())` failed to match at
# all and the case disappeared from the checklist -- silently, which is the one
# thing this script must not do. Deeper nesting is still beyond it, which is what
# the UNPARSED report exists to surface.
NESTED_ARGS = r"\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)"

DECLARATION = re.compile(
    rf"""^(?P<indent>[ \t]*)
        (?P<fn>it|test|describe)
        (?P<modifier>(?:\.(?:each|skip|only|todo|concurrent|fails|failing)
                       (?:{NESTED_ARGS})?)*)
        \s*\(\s*
        (?P<quote>['"`])(?P<title>(?:\\[\s\S]|(?!(?P=quote))[\s\S])*)(?P=quote)
    """,
    re.VERBOSE | re.MULTILINE,
)

# Deliberately loose: anything that *looks* like a declaration. Whatever this
# finds and DECLARATION does not is reported rather than dropped.
#
# The `\b` is belt-and-braces. A review argued that without it `items.map(` and
# `tests.forEach(` would be reported as unparsed declarations; they are not,
# because the character after `it` or `test` there is a letter and not `.` or
# `(`, so the pattern already rejects them. Kept anyway: it costs nothing and
# states the intent, so a later edit to the trailing class cannot introduce the
# false positives the review was worried about.
LOOSE = re.compile(r"^[ \t]*(?:it|test|describe)\b\s*[.(]", re.MULTILINE)


def run(*args: str) -> str:
    result = subprocess.run(
        args, capture_output=True, text=True, encoding="utf8", errors="replace"
    )
    if result.returncode != 0:
        sys.exit(f"command failed: {' '.join(args)}\n{result.stderr}")
    return result.stdout


def changed_lines(
    git_range: str, pathspec: list[str]
) -> tuple[dict[str, set[int]], set[str]]:
    """Touched new-file line numbers per test file, plus the deleted test files."""
    args = ["git", "diff", "-U0", git_range, "--"]
    args += pathspec or DEFAULT_PATHSPEC
    diff = run(*args)

    touched: dict[str, set[int]] = {}
    deleted: set[str] = set()
    path = ""
    old_path = ""
    for line in diff.splitlines():
        # Reset on every file header. Without this a deleted file -- whose `+++`
        # line is `/dev/null` and matches nothing below -- left `path` pointing
        # at the *previous* file, and its hunks were credited to a file they
        # never touched. Raised in review.
        if line.startswith("diff --git "):
            path = ""
            old_path = ""
        elif line.startswith("--- a/"):
            old_path = line[6:]
        elif line.startswith("+++ "):
            target = line[4:]
            if target == "/dev/null":
                if TEST_FILE.search(old_path):
                    deleted.add(old_path)
                path = ""
            elif target.startswith("b/") and TEST_FILE.search(target[2:]):
                path = target[2:]
                touched.setdefault(path, set())
            else:
                path = ""
        elif line.startswith("@@") and path:
            # @@ -old,count +new,count @@
            new = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if not new:
                continue
            start = int(new.group(1))
            # `or 1` was wrong here: for a deletion-only hunk git writes `+9,0`,
            # and the *string* "0" is truthy, so count became 0, the range was
            # empty and the hunk was dropped. Removing an assertion is the
            # highest-signal edit a fix diff can contain, and it was the one edit
            # that could not be seen. Raised in review.
            count = int(new.group(2)) if new.group(2) is not None else 1
            if count == 0:
                # Nothing was added; the cut sits between `start` and the next
                # line. Flag both, so the case that lost lines shows up.
                touched[path].update({max(1, start), start + 1})
            else:
                touched[path].update(range(start, start + count))
    return touched, deleted


def declarations(text: str) -> list[tuple[int, str, str, str]]:
    """(line, kind, modifier, title) for every declaration in the source."""
    found = []
    for match in DECLARATION.finditer(text):
        # Strip the argument lists, keep the modifier names: `.each([...])`
        # displays as `.each`. Stripped with the same balanced pattern that
        # matched them -- a non-greedy `\(.*?\)` leaves residue on nested args,
        # and a greedy `\(.*\)` swallows everything between the first and last
        # paren, so `.each(a).skip.each(b)` lost its middle. Raised in review.
        modifier = re.sub(NESTED_ARGS, "", match.group("modifier") or "")
        line = text.count("\n", 0, match.start()) + 1
        found.append((line, match.group("fn"), modifier, match.group("title")))
    return found


def unparsed(text: str, parsed: list[tuple[int, str, str, str]]) -> list[int]:
    """Lines that look like a declaration but did not parse as one."""
    known = {line for line, *_ in parsed}
    return [
        text.count("\n", 0, m.start()) + 1
        for m in LOOSE.finditer(text)
        if text.count("\n", 0, m.start()) + 1 not in known
    ]


def spans(decls, total):
    """Each declaration owns lines up to the next one, of any kind.

    `describe` is a boundary as well as a declaration. Its own span is the setup
    region before its first case -- hooks, shared fixtures, fakes -- and a change
    there affects every case inside it, so it is reported rather than discarded.
    """
    for index, (line, kind, modifier, title) in enumerate(decls):
        end = decls[index + 1][0] - 1 if index + 1 < len(decls) else total
        yield line, end, kind, modifier, title


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        sys.exit(__doc__)
    git_range = argv[0]
    # A `--` separator is optional. Requiring it meant a pathspec given without
    # one was dropped in silence, narrowing the checklist without saying so --
    # the same shape of failure this script exists to prevent. Raised in review.
    rest = argv[1:]
    pathspec = rest[1:] if rest[:1] == ["--"] else rest

    touched, deleted = changed_lines(git_range, pathspec)
    if not touched and not deleted:
        print(f"No test files changed in {git_range}.")
        return 0

    cases = 0
    setups = 0
    for path in sorted(deleted):
        # Deletion is decided by the diff, not by the working tree. Asking the
        # filesystem answered the wrong question: a file deleted in the range but
        # present on disk today reported as untouched. Raised in review.
        print(f"\n{path}")
        print("  ! deleted in this range -- read its removed cases in the diff by hand")

    for path in sorted(touched):
        lines = touched[path]
        if not lines or path in deleted:
            continue
        source = Path(path)
        if not source.exists():
            print(f"\n{path}\n  ! not on disk -- read this one in the diff by hand")
            continue
        text = source.read_text(encoding="utf8", errors="replace")
        decls = declarations(text)
        length = len(text.splitlines())

        hits = []
        for start, end, kind, modifier, title in spans(decls, length):
            if any(start <= n <= end for n in lines):
                hits.append((start, kind + modifier, title))

        print(f"\n{path}")
        if not hits:
            print("  changed outside any declaration (imports, module-level helpers)")
        for start, kind, title in hits:
            if kind.startswith("describe"):
                print(f"    {path}:{start}  SETUP in {kind}  {title}")
                print("      a hook or fixture here changes every case in the block")
                setups += 1
                continue
            marker = "  !" if any(m in kind for m in (".skip", ".only", ".todo")) else "   "
            print(f"{marker} {path}:{start}  {kind}  {title}")
            cases += 1

        for line in unparsed(text, decls):
            print(f"  ! {path}:{line}  UNPARSED declaration -- read it by hand")

    print(f"\n{cases} test case(s) and {setups} setup region(s) touched by {git_range}.")
    print("\nFor each one, answer both:")
    print("  1. VACUOUS?  Break the code it covers -- does it fail? If not, it proves nothing.")
    print("  2. EXPIRED?  What requirement does it encode, and is that requirement still")
    print("     current? Check it against decisions made AFTER it was written -- a mutation")
    print("     cannot see this, because an expired test fails loudly when you break the code.")
    print("\nThen the other direction: did re-specifying a test strip the ONLY cover from")
    print("behaviour that is still correct? That makes the suite greener, so nothing complains.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
