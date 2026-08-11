"""The model picks an entry, and cannot pick anything else.

AD-5: "The agent selects a named entry from a fixed, version-controlled query
catalog and supplies typed parameters. […] Free-form SQL from a model is never
executed."

Two things the model influences: **which entry**, and **what parameters**. Not
the SQL, which it never sees; not the bind order; not the version; not whether a
provenance row is written. Everything on that second list is decided by code the
model has no reach into, which is what makes the epic's `no model-authored SQL
is possible` a structural claim rather than an instruction.

## Order, which is the design

Fetch the catalog, *then* ask the model, *then* validate the choice, *then*
execute. Each step exists to make the next one's failure impossible:

- The catalog is fetched first, so a model is never asked a question the system
  could not answer anyway. An unauthenticated or malformed catalog fails before
  a token is spent.
- The choice is validated against the catalog before the gateway sees it, so an
  invented entry id does not become a 404 and a provenance row full of entries
  that never existed. The provenance log is the record a board member reads.
- The version is read from the catalog, never from the model.

## Forced tool use lives here, not in the provider

Story 3.4's AC4 assumed Gemini's `tool_config.function_calling_config.mode =
ANY` would be reachable through CrewAI. **It is not.** `crewai==1.15.8`'s native
Gemini provider assembles `GenerateContentConfig` from a fixed list of fields —
temperature, top_p, top_k, max_output_tokens, stop_sequences, system_instruction,
tools — with no `tool_config` and no `additional_params` passthrough. Verified by
reading the installed package.

So a model can answer with prose instead of calling a tool, and `ModelChoseNothing`
is what stops that becoming an answer. That is the stronger half of the two in
any case: `mode = ANY` is a request to the model, while this is a property of
this function — and it holds on the documented ANY-mode failures, where Gemini
rejects the whole request with `INVALID_ARGUMENT` once the combined tool
declarations pass an undocumented size budget.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .catalog_client import CatalogEntryView, declarations_for, fetch_catalog
from .tools_client import InvalidRequest, Transport, execute_catalog_entry


@dataclass(frozen=True)
class ToolChoice:
    """What the model decided: one tool name, and the arguments for it."""

    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class RoutedAnswer:
    """The chosen entry, what it was called with, and what came back.

    The parameters are carried alongside the rows deliberately. Story 3.6 has to
    show a board member the query that produced an answer, and AD-12 logs the
    bound values; an answer that arrived without them would send the surface
    back to the provenance log to ask what it had just done.
    """

    entry_id: str
    version: int
    parameters: dict[str, Any]
    provenance_id: str
    rows: list[dict[str, Any]]


class ModelChoseNothing(RuntimeError):
    """The model answered with prose where a tool call was required.

    Not an empty result set. A router that returned no rows here would turn "I
    could not understand the question" into "this unit owes nothing" — a wrong
    financial answer with a confident face, which is the outcome this product
    exists to prevent.
    """


class ModelChoseUnknownEntry(RuntimeError):
    """The model named a tool the catalog does not hold."""


class Chooser(Protocol):
    """The model call, injected so the suite never opens a socket.

    The same seam `Transport` is, for the same reason. It returns `None` when the
    model declined to call a tool, and the caller decides what that means —
    which is how "forced tool use" is enforced above rather than requested.
    """

    def __call__(self, question: str, declarations: list[dict[str, Any]]) -> ToolChoice | None:
        ...


def route_question(
    question: str,
    *,
    actor_id: str,
    chooser: Chooser | None = None,
    transport: Transport | None = None,
) -> RoutedAnswer:
    """Turn a board member's question into one catalog execution."""
    entries = fetch_catalog(transport=transport)
    by_id = {entry.id: entry for entry in entries}

    choose = chooser or _default_chooser
    choice = choose(question, list(declarations_for(entries)))

    if choice is None:
        raise ModelChoseNothing(
            "the model chose no catalog entry for this question. It is not an answer, and it is "
            "deliberately not an empty result set."
        )

    entry = by_id.get(choice.name)
    if entry is None:
        raise ModelChoseUnknownEntry(
            f"the model named {choice.name!r}, which the catalog does not hold. It holds: "
            f"{', '.join(sorted(by_id)) or 'nothing'}."
        )

    parameters = _checked_parameters(entry, choice.arguments)

    execution = execute_catalog_entry(
        entry_id=entry.id,
        # From the catalog, never from the model. AD-14 versioning is
        # operational, and a model picking a stale version is a silently wrong
        # answer rather than an error.
        version=entry.version,
        parameters=parameters,
        actor_id=actor_id,
        transport=transport,
    )

    return RoutedAnswer(
        entry_id=entry.id,
        version=entry.version,
        parameters=parameters,
        provenance_id=execution.provenance_id,
        rows=execution.rows,
    )


def _checked_parameters(entry: CatalogEntryView, arguments: dict[str, Any]) -> dict[str, Any]:
    """Refuse a bad argument set here, before it costs a round trip.

    **The gateway's `validateParameters` is the enforcement of record**, and this
    does not replace it — it is checked again on the other side, under the schema
    that actually governs binding. What this buys is that an undeclared property
    or a missing required one never becomes a request at all, so the provenance
    log is not the place these are discovered.

    Types are deliberately *not* checked here. That would be a second statement
    of the entry's schema with nothing failing on disagreement, and the gateway
    already refuses a string where an integer belongs.
    """
    declared = set(entry.parameters.get("properties", {}))
    supplied = set(arguments)

    undeclared = sorted(supplied - declared)
    if undeclared:
        raise InvalidRequest(
            f"the model supplied {', '.join(undeclared)}, which {entry.id} does not declare. "
            f"It accepts: {', '.join(sorted(declared)) or 'nothing'}.",
            status=400,
            code="invalid_parameters",
        )

    missing = sorted(set(entry.parameters.get("required", [])) - supplied)
    if missing:
        raise InvalidRequest(
            f"the model omitted {', '.join(missing)}, which {entry.id} requires.",
            status=400,
            code="invalid_parameters",
        )

    return dict(arguments)


def _default_chooser(question: str, declarations: list[dict[str, Any]]) -> ToolChoice | None:
    """The real model call.

    Imported lazily. `crewai` pulls chromadb, onnxruntime and a few hundred other
    modules, and the test suite substitutes this seam in every case — paying
    seconds of import cost on a suite that runs in tenths would be paying it for
    nothing.
    """
    from .model import choose_with_gemini

    return choose_with_gemini(question, declarations)
