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

# `it('...')`, `it("...")`, `it.each(...)('...')`, `test(...)`, and the skip and
# only variants -- which are themselves worth seeing in a diff.
DECLARATION = re.compile(
    r"""^(?P<indent>\s*)
        (?P<fn>it|test|describe)
        (?P<modifier>\.(each\([\s\S]*?\)|skip|only|todo|concurrent|fails))?
        \s*\(\s*
        (?P<quote>['"`])(?P<title>(?:\\.|(?!(?P=quote)).)*)(?P=quote)
    """,
    re.VERBOSE,
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
    path = ""
    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            path = line[6:]
            if TEST_FILE.search(path):
                touched.setdefault(path, set())
            else:
                path = ""
        elif line.startswith("@@") and path:
            # @@ -old,count +new,count @@
            new = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if not new:
                continue
            start = int(new.group(1))
            count = int(new.group(2) or 1)
            touched[path].update(range(start, start + count))
    return touched


def declarations(path: str) -> list[tuple[int, str, str, str]]:
    """(line, kind, modifier, title) for every test declaration in the file."""
    text = Path(path).read_text(encoding="utf8", errors="replace")
    found = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = DECLARATION.match(line)
        if match:
            modifier = match.group("modifier") or ""
            # `.each(...)` can span lines; keep only the marker.
            if modifier.startswith(".each"):
                modifier = ".each"
            found.append(
                (number, match.group("fn"), modifier, match.group("title"))
            )
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
    pathspec = argv[2:] if len(argv) > 1 and argv[1] == "--" else []

    touched = changed_lines(git_range, pathspec)
    if not touched:
        print(f"No test files changed in {git_range}.")
        return 0

    total_cases = 0
    for path in sorted(touched):
        lines = touched[path]
        if not lines:
            continue
        source = Path(path)
        if not source.exists():
            print(f"\n{path}\n  (deleted in the working tree -- review by hand)")
            continue
        decls = declarations(path)
        length = len(source.read_text(encoding="utf8", errors="replace").splitlines())

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
