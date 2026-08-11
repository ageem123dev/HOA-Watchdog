"""AD-17's wire — the only way the gateway reaches this runtime.

    "The Node gateway reaches the Python agent service through **versioned
    ``/chat/v*`` endpoints only**. The **request** carries a question and nothing
    else — no SQL, no rows, and no catalog entry id: naming the entry would move
    intent routing out of the model and quietly undo AD-5. The **response**
    carries the answer, the provenance id, and the rows the answer was drawn
    from."

The spine drew ``NEXT -> PY`` on 2026-07-29 and nothing implemented it until
this story. Everything Epic 3 built before now — a catalog, a provenance log, a
token-checked endpoint, a model that picks an entry, a validator that refuses an
ungrounded number — was unreachable from a browser because this file did not
exist.

## The rejected fields are refused, not dropped

``entryId``, ``version``, ``sql``, ``rows`` and ``parameters`` in a *request* are
a ``400``. Dropping them silently would be easier and is worse: a field the
caller believes was honoured, and was not, is indistinguishable at the call site
from one that was. The next caller tries the same thing.

What the clause protects is story 3.4. A gateway that names the catalog entry is
choosing the query, and AD-5's claim — that a model selects from a fixed catalog
and cannot author SQL — becomes a statement about a component nobody watches.

**The response carries the entry and version**, and that is not a contradiction:
AD-17's prohibition is on a *caller-supplied* entry id. UX-DR6 labels the query
disclosure with ``entry@version``, so the gateway must learn which entry
answered. Learning is the opposite of choosing.

## Both directions have a token, and they are different tokens

AD-17: "one token reused in both directions means either runtime's compromise
grants the other's identity." ``AGENT_SERVICE_TOKEN`` is this service's identity
when it calls Node. ``GATEWAY_SERVICE_TOKEN`` is the gateway's identity when it
calls here. A test plants the other direction's token and asserts it is refused,
because a shared constant would otherwise satisfy every other auth test.

## Starlette, declared

``crewai`` already pulls ``starlette`` and ``uvicorn`` transitively. A transitive
dependency is not a declared one — ``pyproject.toml`` lists what this service is
allowed to hold and ``test_no_data_credentials.py`` checks that list against an
allowlist, so using one means declaring it. Starlette rather than FastAPI
because the request shape is validated by hand either way: AC2 needs fields
*refused* rather than ignored, which is a rule about what the schema rejects, not
a shape a framework infers.
"""

from __future__ import annotations

import json
import logging
from typing import Protocol

from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .routing import ModelChoseNothing, ModelChoseUnknownEntry, RoutedAnswer, route_question
from .tools_client import GatewayError, MisconfiguredAgent, require_environment

#: AD-17: "versioned `/chat/v*` endpoints only".
CHAT_PATH = "/chat/v1/turn"

#: The gateway's identity when it calls here. **Not** `AGENT_SERVICE_TOKEN`,
#: which is this service's identity when it calls Node.
TOKEN_VARIABLE = "GATEWAY_SERVICE_TOKEN"

#: Everything a chat turn's request may carry. **An allowlist**, because the
#: denylist this replaced was bypassable by spelling: it named `entryId`, so
#: `entry_id` and `catalogEntry` sailed through with a 200. Verified rather than
#: reasoned about, and raised by CodeRabbit.
#:
#: This project already made the argument once, in `test_no_data_credentials.py`:
#: "the allowlist is the real check; the denylist below only makes the message
#: better", because a denylist is a list of the things somebody thought of.
PERMITTED_FIELDS = ("question", "actorId")

#: Kept for the message only. A request naming one of these gets an explanation
#: rather than a bare "unknown field", because these are the ones somebody tries
#: on purpose.
FORBIDDEN_FIELDS = ("entryId", "version", "sql", "rows", "parameters")

#: A question is a sentence. The limit is enforced before `json.loads`, so an
#: oversized body is refused at the boundary rather than parsed first.
MAX_BODY_BYTES = 64 * 1024

_log = logging.getLogger(__name__)


class Router(Protocol):
    """`routing.route_question`, injected so no test calls a model."""

    def __call__(self, question: str, actor_id: str) -> RoutedAnswer:
        ...


class Narrator(Protocol):
    """Turns rows into the sentence a board member reads.

    Injected for the same reason, and separate from the router because the two
    fail differently: a router that cannot choose is an honest "I have no entry
    for that", while a narrator that cannot write is an internal fault.
    """

    def __call__(self, question: str, routed: RoutedAnswer) -> str:
        ...


def _failure(status: int, code: str, message: str) -> JSONResponse:
    """`{code, message}`, the architecture's one error envelope."""
    return JSONResponse({"code": code, "message": message}, status_code=status)


def _presented_token(request: Request) -> str | None:
    """The bearer value, or `None`.

    Strict about the scheme, matching `core/tools/http.ts` on the other side: a
    header that is missing, malformed, or uses any scheme but `Bearer` is the
    same refusal as a wrong token, because telling those apart tells a stranger
    how to try again.
    """
    header = request.headers.get("authorization")
    if header is None:
        return None

    parts = header.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None

    return parts[1] or None


def _authentic(presented: str | None) -> bool:
    """Constant-time comparison against the configured token.

    The property `core/tools/service-token.ts` holds on the other side, ported
    rather than imported — the two runtimes share no code, and a second
    comparison that is subtly different is worse than an obvious parallel one.
    An unset or blank configured token refuses everyone: an absent secret is when
    this endpoint is most exposed and least watched, and an unauthenticated turn
    is a model call anyone can pay for.
    """
    try:
        configured = require_environment(TOKEN_VARIABLE)
    except MisconfiguredAgent:
        return False

    if presented is None:
        return False

    import hmac

    # Compared as bytes. `hmac.compare_digest` raises on a non-ASCII `str`, and
    # this is *unauthenticated* input — an unhandled UnicodeEncodeError here is a
    # 500 anyone can trigger with no credential at all, which is a crash reachable
    # from outside the boundary the token exists to be. Raised by CodeRabbit.
    return hmac.compare_digest(presented.encode("utf-8"), configured.encode("utf-8"))


def _read_question(payload: object) -> tuple[str, str] | JSONResponse:
    if not isinstance(payload, dict):
        return _failure(400, "invalid_request", "the request body must be a JSON object")

    unknown = [field for field in payload if field not in PERMITTED_FIELDS]
    if unknown:
        # The named ones get the reason; the rest get the rule. Both are refused,
        # which is the part a denylist could not promise.
        deliberate = [field for field in unknown if field in FORBIDDEN_FIELDS]
        why = (
            " Choosing the catalog entry is the model's, and naming it here would move intent "
            "routing out of it (AD-17)."
            if deliberate
            else ""
        )
        return _failure(
            400,
            "invalid_request",
            f"a chat turn carries {' and '.join(PERMITTED_FIELDS)} only; "
            f"remove {', '.join(sorted(unknown))}.{why}",
        )

    question = payload.get("question")
    if not isinstance(question, str) or question.strip() == "":
        return _failure(400, "invalid_request", "question must be a non-empty string")

    actor_id = payload.get("actorId")
    if not isinstance(actor_id, str) or actor_id.strip() == "":
        return _failure(400, "invalid_request", "actorId must be a non-empty string")

    return question, actor_id


def create_app(*, route: Router | None = None, narrate: Narrator | None = None) -> Starlette:
    """The service, with its two external calls as parameters."""
    router: Router = route or route_question
    narrator: Narrator = narrate or _default_narrator

    async def turn(request: Request) -> JSONResponse:
        # Verify, then parse, then route — the order story 3.2 established on the
        # other side. A rejected caller must not reach the model, not least
        # because reaching it costs money.
        if not _authentic(_presented_token(request)):
            return _failure(401, "unauthenticated", "this endpoint serves the gateway only")

        # `content-length` first, because it is free when honest.
        declared = request.headers.get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
            return _failure(413, "request_too_large", "a question is a sentence, not a payload")

        # Then read in chunks and stop at the limit. `await request.body()`
        # buffers the whole body *before* it can be measured, so a caller that
        # omits or falsifies `content-length` chooses the allocation — the header
        # check above is a claim, not a bound.
        #
        # **No test here discriminates this fix**, and that is worth saying rather
        # than implying. The oversized-body tests pass either way, because both
        # shapes end in a 413; what changes is how much was allocated first, and
        # neither the test client nor the assertion can observe that. The fix
        # stands on the reasoning, not on a red test turning green.
        # Raised by CodeRabbit.
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BODY_BYTES:
                return _failure(413, "request_too_large", "a question is a sentence, not a payload")

        try:
            payload = json.loads(bytes(body))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return _failure(400, "invalid_request", "the request body is not valid JSON")

        read = _read_question(payload)
        if isinstance(read, JSONResponse):
            return read

        question, actor_id = read

        try:
            # In a threadpool, because both of these are *blocking* — the router
            # makes an HTTP call to the gateway and the narrator calls a model,
            # each a matter of seconds. Awaited directly in an async handler they
            # block the event loop, so one slow turn stalls every other request
            # this process is serving, including the health of the service
            # itself. Raised by CodeRabbit.
            routed = await run_in_threadpool(router, question=question, actor_id=actor_id)
        except (ModelChoseNothing, ModelChoseUnknownEntry) as refusal:
            # An honest "no entry answers that", not a fault. Story 3.7 gives it
            # a face; this gives it a status a caller can tell apart.
            return _failure(422, "no_catalog_match", str(refusal))
        except GatewayError:
            # Deliberately generic. A gateway error carries table names and
            # sometimes row values, and this response crosses back to a runtime
            # that will render it.
            _log.exception("the gateway refused a catalog execution during a chat turn")
            return _failure(502, "gateway_unavailable", "the records could not be reached")
        except Exception:
            _log.exception("a chat turn failed")
            return _failure(500, "internal", "the turn could not be completed")

        try:
            answer = await run_in_threadpool(narrator, question=question, routed=routed)
        except Exception:
            _log.exception("narration failed during a chat turn")
            return _failure(500, "internal", "the turn could not be completed")

        if not isinstance(answer, str) or answer.strip() == "":
            # A blank answer reads as "there is nothing to report", which for a
            # balance is a wrong financial answer with a confident face. Story
            # 3.5 closed the same hole in `groundedAnswer`; this is the wire's
            # half of it.
            _log.error("narration produced no answer")
            return _failure(500, "internal", "the turn could not be completed")

        return JSONResponse(
            {
                "answer": answer,
                "provenanceId": routed.provenance_id,
                "rows": routed.rows,
                # The entry and version the *response* names, for UX-DR6's
                # disclosure. AD-17 forbids a caller-supplied entry id; telling
                # the caller which entry answered is the opposite of that.
                "entryId": routed.entry_id,
                "version": routed.version,
                "parameters": routed.parameters,
            }
        )

    return Starlette(routes=[Route(CHAT_PATH, turn, methods=["POST"])])


def _default_narrator(*, question: str, routed: RoutedAnswer) -> str:
    """The real narration, imported lazily.

    Story 3.6b renders what this returns, behind AD-7's validator on the Node
    side. Kept out of module scope so importing the app does not import `crewai`.
    """
    from .narrate import narrate_answer

    return narrate_answer(question=question, routed=routed)

