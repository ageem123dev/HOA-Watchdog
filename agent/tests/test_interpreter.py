"""AD-15's interpreter pin, enforced rather than declared.

    "The Python service pins **Python 3.13** - CrewAI's ``requires_python`` is
    ``<3.14,>=3.10``, so the ambient 3.14 interpreter cannot host it."

This is not a style rule and the failure it prevents is not obvious. On this
machine the ambient interpreter is **3.14.6** and ``py -3.13`` is 3.13.14, so
``python3 -m venv`` - the command anyone would reach for - builds an environment
CrewAI can never be installed into. Nothing fails at that moment. Nothing fails
when the service is written, or tested, or reviewed. It fails in story 3.4, at
``pip install crewai``, a long way from the decision that caused it.

So the range is asserted twice and the two must agree: once here against the
running interpreter, and once against ``pyproject.toml``'s declaration. Migration
007's comment states the standard - a second statement of a shape is only safe
when something fails on disagreement.
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent

# The range AD-15 quotes from CrewAI, verbatim. If CrewAI widens it, this and
# pyproject.toml change together and the architecture note changes with them.
MINIMUM = (3, 10)
EXCLUSIVE_MAXIMUM = (3, 14)


def _requires_python() -> str:
    with (AGENT_ROOT / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)["project"]["requires-python"]


def test_the_running_interpreter_is_one_crewai_can_host() -> None:
    """The interpreter actually running the suite, not the one declared.

    A declaration nothing checks is how the wrong venv survives review.
    """
    assert sys.version_info >= MINIMUM, (
        f"running {sys.version.split()[0]}, below CrewAI's floor of "
        f"{MINIMUM[0]}.{MINIMUM[1]}"
    )
    assert sys.version_info < EXCLUSIVE_MAXIMUM, (
        f"running {sys.version.split()[0]}; CrewAI's requires_python excludes "
        f"{EXCLUSIVE_MAXIMUM[0]}.{EXCLUSIVE_MAXIMUM[1]} and above. The ambient "
        "interpreter on this machine is 3.14 - build the venv with `py -3.13 -m venv`."
    )


def test_pyproject_declares_the_same_range() -> None:
    """The declaration and the architecture note, checked against each other."""
    declared = _requires_python().replace(" ", "")

    assert f">={MINIMUM[0]}.{MINIMUM[1]}" in declared, declared
    assert f"<{EXCLUSIVE_MAXIMUM[0]}.{EXCLUSIVE_MAXIMUM[1]}" in declared, declared


def test_python_version_file_pins_the_minor_series() -> None:
    """`.python-version` is what a tool reads to pick an interpreter.

    `pyproject.toml` states a range; this states the one the project actually
    uses. A range alone would let 3.10 through, which is inside CrewAI's window
    and is not what the architecture pinned.
    """
    pinned = (AGENT_ROOT / ".python-version").read_text(encoding="utf-8").strip()

    assert pinned == "3.13", f".python-version says {pinned!r}, expected '3.13'"

    major, minor = (int(part) for part in pinned.split("."))
    assert (major, minor) >= MINIMUM
    assert (major, minor) < EXCLUSIVE_MAXIMUM
