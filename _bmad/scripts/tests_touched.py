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

It errs toward listing too much. A case owns every line from its declaration to
the next one, so inserting a test directly after another can flag the earlier,
untouched neighbour too. That is the right direction to be wrong in: a spurious
entry costs one re-read, a missing one costs what this whole step exists to
catch.

Usage:
    python3 _bmad/scripts/tests_touched.py <git-range> [-- <pathspec>...]
    python3 _bmad/scripts/tests_touched.py HEAD~1..HEAD
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

TEST_FILE = re.compile(r"\.(test|spec)\.(ts|tsx|js|mjs)$")

# `it('...')`, `it.each([...])('...')`, `test(...)`, and the skip/only variants --
# which are themselves worth seeing in a diff.
#
# Matched against the whole file rather than line by line, because `it.each` takes
# a table that routinely spans lines and a per-line match cannot see the title
# that follows it. Modifiers are allowed to chain (`it.skip.each`), which a single
# alternation could not express. Both gaps were raised in review.
DECLARATION = re.compile(
    r"""^(?P<indent>[ \t]*)
        (?P<fn>it|test|describe)
        (?P<modifier>(?:\.(?:each|skip|only|todo|concurrent|fails|failing)
                       (?:\([\s\S]*?\))?)*)
        \s*\(\s*
        (?P<quote>['"`])(?P<title>(?:\\.|(?!(?P=quote)).)*)(?P=quote)
    """,
    re.VERBOSE | re.MULTILINE,
)


def run(*args: str) -> str:
    result = subprocess.run(
        args, capture_output=True, text=True, encoding="utf8", errors="replace"
    )
    if result.returncode != 0:
        sys.exit(f"command failed: {' '.join(args)}\n{result.stderr}")
    return result.stdout


def changed_lines(git_range: str, pathspec: list[str]) -> dict[str, set[int]]:
    """New-file line numbers touched per test file, from a zero-context diff."""
    args = ["git", "diff", "-U0", git_range, "--"]
    args += pathspec or ["*.test.ts", "*.test.tsx", "*.spec.ts", "*.spec.tsx"]
    diff = run(*args)

    touched: dict[str, set[int]] = {}
    deleted: set[str] = set()
    path = ""
    old_path = ""
    for line in diff.splitlines():
        # Reset on every file header. Without this, a deleted file -- whose
        # `+++` line is `/dev/null` and matches nothing below -- leaves `path`
        # pointing at the *previous* file, and its hunks are then credited to
        # a file they never touched. Raised in review.
        if line.startswith("diff --git "):
            path = ""
            old_path = ""
        elif line.startswith("--- a/"):
            old_path = line[6:]
        elif line.startswith("+++ "):
            target = line[4:]
            if target == "/dev/null":
                # The file was deleted. There is nothing to read line numbers
                # against, so record it for a by-hand review instead.
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
            # `or 1` was wrong here: for a deletion-only hunk git writes
            # `+9,0`, and the *string* "0" is truthy, so count became 0 and the
            # hunk was skipped outright. Removing an assertion is the highest-
            # signal edit this whole check exists to catch, and it was the one
            # edit that could not be seen. Raised in review.
            count = int(new.group(2)) if new.group(2) is not None else 1
            if count == 0:
                # Nothing was added; the removal sits between `start` and the
                # line after it. Flag both so the case that lost lines shows up.
                touched[path].update({max(1, start), start + 1})
            else:
                touched[path].update(range(start, start + count))
    for path in deleted:
        touched.setdefault(path, set())
    return touched


def declarations(text: str) -> list[tuple[int, str, str, str]]:
    """(line, kind, modifier, title) for every test declaration in the source.

    Scanned over the whole text, not line by line, so a multi-line `it.each`
    table does not hide the title that follows it.
    """
    found = []
    for match in DECLARATION.finditer(text):
        modifier = match.group("modifier") or ""
        # Keep the marker, drop the table: `.each([...])` becomes `.each`.
        modifier = re.sub(r"\([\s\S]*?\)", "", modifier)
        line = text.count("\n", 0, match.start()) + 1
        found.append((line, match.group("fn"), modifier, match.group("title")))
    return found


def spans(decls, total):
    """Each declaration owns lines up to the next declaration."""
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
    # the same shape of failure this script is meant to prevent. Raised in review.
    rest = argv[1:]
    pathspec = rest[1:] if rest[:1] == ["--"] else rest

    touched = changed_lines(git_range, pathspec)
    if not touched:
        print(f"No test files changed in {git_range}.")
        return 0

    total_cases = 0
    for path in sorted(touched):
        lines = touched[path]
        source = Path(path)
        if not source.exists():
            print(f"\n{path}\n  ! deleted -- read the removed cases in the diff by hand")
            continue
        if not lines:
            continue
        text = source.read_text(encoding="utf8", errors="replace")
        decls = declarations(text)
        length = len(text.splitlines())

        hits = []
        for start, end, kind, modifier, title in spans(decls, length):
            if kind == "describe":
                continue
            if any(start <= n <= end for n in lines):
                hits.append((start, kind + modifier, title))

        print(f"\n{path}")
        if not hits:
            print("  changed outside any test case (imports, fakes, helpers)")
        for start, kind, title in hits:
            marker = "  !" if any(m in kind for m in (".skip", ".only", ".todo")) else "   "
            print(f"{marker} {path}:{start}  {kind}  {title}")
            total_cases += 1

    print(f"\n{total_cases} test case(s) touched by {git_range}.")
    print("\nFor each one, answer both:")
    print("  1. VACUOUS?  Break the code it covers -- does it fail? If not, it proves nothing.")
    print("  2. EXPIRED?  What requirement does it encode, and is that requirement still")
    print("     current? Check it against decisions made AFTER it was written -- a mutation")
    print("     cannot see this, because an expired test fails loudly when you break the code.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
