"""AD-18 - the agent service relays the actor assertion and cannot mint one.

    "A ``/tools/v1/*`` request establishes **which board member it is for** by
    presenting a short-lived assertion **minted by the Node gateway and verified
    by the Node gateway**. The agent service **relays it opaquely and holds no
    signing key**."

That last clause is the whole reason the assertion is worth anything. An agent
that could mint one could name any board member, which is precisely the property
AD-18 exists to remove - and it would do so while every other check in the system
still passed, because a minted assertion is a *valid* assertion.

**This checks capability, not current imports**, for the reason
``test_no_data_credentials.py`` gives about AD-3: a grep for ``hmac`` proves
nothing about what the runtime can reach. So it looks where a key would have to
come from - the environment the service asks for, and the committed
configuration - rather than at what the code happens to say today.

The sibling property, that the model cannot choose the *subject*, is pinned on
the Node side by ``core/security/actor-is-never-chosen.test.ts``. Together they
say: the agent chooses neither who the turn is for nor what proves it.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
PACKAGE = AGENT_ROOT / "watchdog_agent"

#: Names that would be a signing key if the agent asked for one. The Node side
#: calls it ``ACTOR_ASSERTION_KEY``; the rest are the shapes somebody reaches for
#: when wiring "just make it work" at three in the morning.
KEY_SHAPED = re.compile(
    r"ACTOR_ASSERTION|SIGNING_KEY|ASSERTION_KEY|ACTOR_KEY|HMAC_KEY|JWT_SECRET",
    re.IGNORECASE,
)


def _names_in(source: str) -> set[str]:
    """Every string constant this source could be naming a variable with.

    **Deliberately over-broad**, and it was raised as too broad in review. It
    collects the arguments of *every* call rather than matching ``os.getenv``
    and ``os.environ.get`` by name, because the pattern that matters is the one
    nobody predicted: a helper, a settings wrapper, a ``dotenv`` call, a name
    passed through a constant. Narrowing this to the two spellings anybody would
    think of makes it precise about exactly the cases that were never the risk.

    The cost of the breadth is a false positive on an unrelated string that
    happens to look like a key name, which fails loudly and is fixed in a
    minute. The cost of the precision is a key the sweep does not see.
    """
    asked: set[str] = set()

    for node in ast.walk(ast.parse(source)):
        # os.getenv("NAME") / os.environ.get("NAME") / anything("NAME")
        if isinstance(node, ast.Call):
            for argument in node.args:
                if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                    asked.add(argument.value)
        # os.environ["NAME"]
        if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
            if isinstance(node.slice.value, str):
                asked.add(node.slice.value)

    return asked


def _environment_names() -> set[str]:
    """Every such name across the package."""
    asked: set[str] = set()

    for path in PACKAGE.rglob("*.py"):
        asked |= _names_in(path.read_text(encoding="utf-8"))

    return asked


def test_the_package_has_source_to_scan() -> None:
    """Without this the sweeps below pass by reading nothing."""
    sources = list(PACKAGE.rglob("*.py"))

    assert len(sources) >= 5, f"only found {len(sources)} modules under {PACKAGE}"


def test_the_agent_asks_its_environment_for_no_signing_key() -> None:
    """The capability check. A key it never asks for is a key it cannot use."""
    offenders = sorted(name for name in _environment_names() if KEY_SHAPED.search(name))

    assert offenders == [], (
        "the agent service reads a signing-key-shaped variable "
        f"({', '.join(offenders)}). AD-18: it relays the assertion and holds no key - "
        "a relay that can mint is not a relay."
    )


#: A module that reads the key four different ways. The guard's whole value
#: rests on the collector finding names like these, and the package itself
#: contains none of them by design — so scanning the real source can never
#: demonstrate that the collector works. Raised by CodeRabbit.
A_MODULE_THAT_READS_THE_KEY = """
import os
from os import environ

DIRECT = os.getenv("ACTOR_ASSERTION_KEY")
VIA_GET = os.environ.get("ACTOR_SIGNING_KEY", "")
VIA_SUBSCRIPT = environ["HMAC_KEY"]


def _settings(name):
    return os.environ.get(name)


THROUGH_A_WRAPPER = _settings("JWT_SECRET")
"""


def test_the_collector_finds_a_key_a_module_actually_reads() -> None:
    """Without this, an empty collector reports the package clean forever.

    Every other assertion here is satisfied by ``_environment_names()``
    returning nothing at all — which is exactly what a broken AST walk, a
    renamed package or a wrong root produces.
    """
    found = _names_in(A_MODULE_THAT_READS_THE_KEY)

    assert "ACTOR_ASSERTION_KEY" in found
    assert "ACTOR_SIGNING_KEY" in found
    assert "HMAC_KEY" in found
    # The wrapper case: the name is a literal at a call site that is not
    # `os.getenv`, which is the reason the collector matches every call.
    assert "JWT_SECRET" in found


def test_the_guard_refuses_that_module_end_to_end() -> None:
    """Collector and matcher composed, which is how the real sweep runs them."""
    offenders = sorted(n for n in _names_in(A_MODULE_THAT_READS_THE_KEY) if KEY_SHAPED.search(n))

    assert offenders == ["ACTOR_ASSERTION_KEY", "ACTOR_SIGNING_KEY", "HMAC_KEY", "JWT_SECRET"]


def test_the_real_package_yields_names_to_check() -> None:
    """The package does read *some* environment variables — just not a key."""
    assert _environment_names(), "the collector found no names at all in the package"


def test_the_matcher_would_notice_a_key_if_one_were_added() -> None:
    """A guard whose matcher is wrong reports success forever."""
    assert KEY_SHAPED.search("ACTOR_ASSERTION_KEY")
    assert KEY_SHAPED.search("actor_signing_key")
    assert KEY_SHAPED.search("JWT_SECRET")
    # And does not fire on the two secrets the agent legitimately holds.
    assert not KEY_SHAPED.search("GATEWAY_SERVICE_TOKEN")
    assert not KEY_SHAPED.search("GEMINI_API_KEY")


def test_no_committed_agent_config_carries_a_signing_key() -> None:
    """The other place a secret arrives: a file somebody checked in."""
    offenders: list[str] = []

    for path in AGENT_ROOT.rglob("*"):
        if not path.is_file() or ".venv" in path.parts or "__pycache__" in path.parts:
            continue
        if path.suffix not in {".toml", ".ini", ".cfg", ".yaml", ".yml", ".json", ".env"}:
            continue
        if KEY_SHAPED.search(path.read_text(encoding="utf-8", errors="replace")):
            offenders.append(str(path.relative_to(AGENT_ROOT)))

    assert offenders == [], f"signing-key-shaped configuration committed under agent/: {offenders}"


def test_the_relay_passes_the_assertion_through_without_reading_it() -> None:
    """It forwards the assertion; it does not parse, split or re-sign it.

    Decoding would be the first step toward trusting its contents, and the
    agent has no key with which to know whether those contents are true.
    """
    relay = (PACKAGE / "routing.py").read_text(encoding="utf-8")
    client = (PACKAGE / "tools_client.py").read_text(encoding="utf-8")

    for name, source in (("routing.py", relay), ("tools_client.py", client)):
        assert "actor_assertion" in source, f"{name} does not carry the assertion"
        for forbidden in ("b64decode", "urlsafe_b64decode", "json.loads(actor", "hmac", "new_hmac"):
            assert forbidden not in source, (
                f"{name} appears to inspect the assertion ({forbidden}). "
                "AD-18: the agent relays it opaquely."
            )
