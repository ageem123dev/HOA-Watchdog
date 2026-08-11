"""What the reasoning side may ask for, fetched rather than restated.

AD-15 makes the versioned ``/tools/*`` endpoints the only wire between the two
runtimes, and ``GET /tools/v1/catalog`` is where the catalog crosses it. The
alternative — a dict of entry ids and parameter schemas written a second time in
Python — is the mistake migration 007's comment records: a second statement of a
shape with nothing failing on disagreement. Here the disagreement would not even
be loud. A stale parameter *name* is a request the gateway rejects; a stale
parameter *type* is a request it accepts and binds wrongly.

**Everything here fails closed.** A refusal, a malformed body, an entry missing a
field: all raise. None of them returns an empty catalog, because a model handed
zero tools cannot call one, and forced tool use then fails with an argument error
rather than an authentication error — sending whoever debugs it to the wrong
place entirely. That is the same rule ``tools_client.py`` applies to a 401
becoming an empty result set, one layer up.

**AD-5 is asserted on this side too.** ``app/tools/v1/catalog/route.ts`` is
tested not to send SQL; this is tested not to accept it. Two independent
statements of "the model never sees SQL", either of which fails on its own — so
a regression in the projection on the Node side goes red in the suite that sits
next to the code handing declarations to a model.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .tools_client import GatewayError, Transport, call_gateway

CATALOG_PATH = "/tools/v1/catalog"

#: Keys an entry must never carry. Not a restatement of the projection on the
#: Node side — a receiving-side refusal, so the boundary holds even if that
#: projection regresses.
FORBIDDEN_KEYS = ("sql", "bind")


class MalformedCatalog(GatewayError):
    """The gateway answered, and what it said is not a catalog.

    A subclass of ``GatewayError`` so a caller handling "the gateway did not give
    me a usable answer" catches this too, rather than dying on an unfamiliar
    exception type at the one moment it is trying to fail gracefully.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message, status=200)


@dataclass(frozen=True)
class CatalogEntryView:
    """One entry as the model meets it — and as `execute_catalog_entry` is called.

    Frozen, because the declarations handed to a model and the ``(entry_id,
    version)`` later sent to the gateway must be the same pair. A mutable view
    is a route by which the model could be shown one entry and the executor
    asked for another.
    """

    id: str
    version: int
    description: str
    parameters: dict[str, Any]


def fetch_catalog(*, transport: Transport | None = None) -> list[CatalogEntryView]:
    """Ask the gateway which entries exist, and return the newest of each id.

    Raises ``MisconfiguredAgent`` before calling anything if the service is not
    configured, and a ``GatewayError`` subclass for anything that is not a
    well-formed catalog.
    """
    _, payload = call_gateway(
        "GET",
        CATALOG_PATH,
        transport=transport,
        refusal="the gateway refused the catalog request",
    )

    if not isinstance(payload, dict):
        raise MalformedCatalog("the gateway returned a catalog that was not an object")

    entries = payload.get("entries")
    if not isinstance(entries, list):
        raise MalformedCatalog("the gateway returned a catalog with no entries list")

    # An empty catalog is a broken deployment, not a valid state: there is at
    # least one entry in the repository, so nothing here means the gateway is
    # answering from somewhere the catalog is not.
    if not entries:
        raise MalformedCatalog("the gateway returned a catalog holding no entries at all")

    newest: dict[str, CatalogEntryView] = {}
    for raw_entry in entries:
        view = _view_of(raw_entry)
        seen = newest.get(view.id)
        # Highest version wins regardless of the order they arrived in. Ordering
        # is the gateway's business and nothing promises it.
        if seen is None or view.version > seen.version:
            newest[view.id] = view

    return list(newest.values())


def _view_of(raw_entry: object) -> CatalogEntryView:
    if not isinstance(raw_entry, dict):
        raise MalformedCatalog("a catalog entry was not an object")

    for key in FORBIDDEN_KEYS:
        if key in raw_entry:
            raise MalformedCatalog(
                f"a catalog entry carried {key!r}, which the reasoning side must never be given "
                "(AD-5). The gateway's projection is supposed to drop it."
            )

    for field in ("id", "version", "description", "parameters"):
        if field not in raw_entry:
            raise MalformedCatalog(f"a catalog entry has no {field}")

    entry_id = raw_entry["id"]
    if not isinstance(entry_id, str) or entry_id.strip() == "":
        raise MalformedCatalog("a catalog entry has no usable id")

    version = raw_entry["version"]
    # `bool` is an `int` in Python, and `True` would sail through an isinstance
    # check and then be sent to the gateway as a version.
    if not isinstance(version, int) or isinstance(version, bool):
        raise MalformedCatalog(f"{entry_id} has a version that is not an integer")

    description = raw_entry["description"]
    if not isinstance(description, str) or description.strip() == "":
        raise MalformedCatalog(f"{entry_id} has no description for a model to choose on")

    return CatalogEntryView(
        id=entry_id,
        version=version,
        description=description,
        # Deep-copied, so the view, the decoded payload and the declaration handed
        # to the model are not three names for one dict. The declaration goes to
        # CrewAI, which is third-party code this module does not control, and the
        # same object is what `_checked_parameters` later validates the model's
        # arguments against. A provider that normalised a schema in place would
        # move the goalposts between the question and the check. Raised by
        # CodeRabbit.
        parameters=deepcopy(_schema_of(entry_id, raw_entry["parameters"])),
    )


def _schema_of(entry_id: str, parameters: object) -> dict[str, Any]:
    if not isinstance(parameters, dict):
        raise MalformedCatalog(f"{entry_id} has parameters that are not an object")

    if parameters.get("type") != "object":
        raise MalformedCatalog(f"{entry_id} has parameters whose type is not 'object'")

    if not isinstance(parameters.get("properties"), dict):
        raise MalformedCatalog(f"{entry_id} has parameters with no properties object")

    # The Consistency Conventions: "Every agent-facing tool declares `strict:
    # true` and `additionalProperties: false`. A tool without both is not
    # registered." This is the registration, so this is where it is refused.
    # `additionalProperties: false` is precisely what makes a `sql` key the model
    # invents refusable rather than forwarded.
    if parameters.get("additionalProperties") is not False:
        raise MalformedCatalog(
            f"{entry_id} has a schema that does not set additionalProperties to false, so a "
            "property the model invents would be forwarded rather than refused"
        )

    return parameters


def declarations_for(entries: list[CatalogEntryView]) -> list[dict[str, Any]]:
    """The function declarations handed to the model.

    One per entry **id**, never one per version. AD-14 versioning is operational:
    handing a model ``dues_status@1`` and ``dues_status@2`` asks it to choose
    between two spellings of one question, and the wrong choice is a silently
    stale answer rather than an error. ``fetch_catalog`` has already reduced to
    the newest of each id; the agent supplies the version, mirroring
    ``currentVersionOf`` on the Node side.

    The schema travels verbatim. Rewriting it here would be the second statement
    this whole module exists to avoid.
    """
    return [
        {"name": entry.id, "description": entry.description, "parameters": entry.parameters}
        for entry in entries
    ]

