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


def _environment_names() -> set[str]:
    """Every string this package passes to ``os.environ`` / ``os.getenv``."""
    asked: set[str] = set()

    for path in PACKAGE.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))

        for node in ast.walk(tree):
            # os.getenv("NAME") / os.environ.get("NAME")
            if isinstance(node, ast.Call):
                for argument in node.args:
                    if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
                        asked.add(argument.value)
            # os.environ["NAME"]
            if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
                if isinstance(node.slice.value, str):
                    asked.add(node.slice.value)

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
