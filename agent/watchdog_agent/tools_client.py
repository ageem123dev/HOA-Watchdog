"""The agent service's only way to obtain a fact.

AD-3: "It obtains every fact by calling Node's tool endpoints." AD-15: those
endpoints "are the sole data path in the system".

This module holds **no database credential and asks for none** - it reads exactly
two variables, the bearer token and the gateway's address, and
``agent/tests/test_no_data_credentials.py`` asserts that over this package's
source. A connection string here would make AD-3 false and would make the
provenance log in story 3.1 a record of only some queries.

**Every non-2xx raises.** That is the design decision worth stating: a client
that returned ``[]`` on a ``401`` would turn "you are not authorised" into "this
unit owes nothing" - a wrong financial answer delivered with confidence, which is
the outcome this product exists to prevent. The same applies to a ``200`` whose
body is not the shape the gateway promises.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Protocol

#: The versioned path AD-15 requires. Story 3.2 serves it.
TOOL_PATH = "/tools/v1/catalog/execute"

TOKEN_VARIABLE = "AGENT_SERVICE_TOKEN"
GATEWAY_VARIABLE = "GATEWAY_BASE_URL"


class MisconfiguredAgent(RuntimeError):
    """The service cannot make a call at all, and should not try.

    Raised **before** any request. Sending an unauthenticated request and letting
    the gateway answer 401 would work, in the sense that the caller still gets an
    error - but it puts the diagnostic in the gateway's log, where a misdeployed
    agent is indistinguishable from someone probing the endpoint. The error
    belongs where the missing variable is.
    """


class GatewayError(RuntimeError):
    """The gateway did not return an answer.

    Carries the HTTP status and, when the gateway sent its envelope, the `code`
    from it. Never raised for a successful call, and never *not* raised for an
    unsuccessful one.
    """

    def __init__(self, message: str, *, status: int, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class GatewayAuthError(GatewayError):
    """401 - this runtime is not the agent service as far as the gateway knows."""


class CatalogEntryNotFound(GatewayError):
    """404 - the catalog holds no such entry or version."""


class InvalidRequest(GatewayError):
    """400 - the request or its parameters did not match the entry's schema."""


class Transport(Protocol):
    """Injected so the suite never opens a socket."""

    def __call__(self, method: str, url: str, headers: dict[str, str], body: str) -> tuple[int, str]:
        ...


@dataclass(frozen=True)
class CatalogExecution:
    """What the gateway returned: the rows, and the proof they were logged."""

    provenance_id: str
    rows: list[dict[str, Any]]


def _required(variable: str) -> str:
    value = os.environ.get(variable)
    if value is None or value.strip() == "":
        raise MisconfiguredAgent(
            f"{variable} is not set. The agent service cannot call the gateway without it, "
            "and deliberately does not try."
        )
    return value


def _urllib_transport(method: str, url: str, headers: dict[str, str], body: str) -> tuple[int, str]:
    request = urllib.request.Request(url, data=body.encode("utf-8"), headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        # An HTTP error is an answer, not a transport failure - the body carries
        # the gateway's envelope and the status is what the mapping below needs.
        return error.code, error.read().decode("utf-8", errors="replace")


_STATUS_ERRORS: dict[int, Callable[..., GatewayError]] = {
    400: InvalidRequest,
    401: GatewayAuthError,
    404: CatalogEntryNotFound,
}


def execute_catalog_entry(
    *,
    entry_id: str,
    version: int,
    parameters: dict[str, Any],
    actor_id: str,
    transport: Transport | None = None,
) -> CatalogExecution:
    """Run a catalog entry through the gateway and return its rows.

    Raises `MisconfiguredAgent` before calling anything if the service is not
    configured, and a `GatewayError` subclass for every response that is not a
    well-formed success.
    """
    token = _required(TOKEN_VARIABLE)
    base_url = _required(GATEWAY_VARIABLE)

    send = transport or _urllib_transport
    status, raw = send(
        "POST",
        f"{base_url.rstrip('/')}{TOOL_PATH}",
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json.dumps(
            {
                "entryId": entry_id,
                "version": version,
                "parameters": parameters,
                "actorId": actor_id,
            }
        ),
    )

    payload = _decode(raw)

    if status < 200 or status >= 300:
        code = payload.get("code") if isinstance(payload, dict) else None
        raise _STATUS_ERRORS.get(status, GatewayError)(
            f"the gateway refused the request with {status}",
            status=status,
            code=code if isinstance(code, str) else None,
        )

    if not isinstance(payload, dict):
        raise GatewayError("the gateway returned a success that was not an object", status=status)

    # Both fields are required, and the provenance id is not decoration: AD-12
    # makes it part of what an answer means. A result without one came from a
    # path that did not log, or from something that is not the gateway.
    for field in ("provenanceId", "rows"):
        if field not in payload:
            raise GatewayError(
                f"the gateway returned a success with no {field}", status=status
            )

    rows = payload["rows"]
    if not isinstance(rows, list):
        raise GatewayError("the gateway returned rows that were not a list", status=status)

    return CatalogExecution(provenance_id=str(payload["provenanceId"]), rows=rows)


def _decode(raw: str) -> Any:
    """The body, or `None` if it is not JSON.

    A gateway that answers with an HTML error page is still an answer worth
    reporting by status; failing to parse it must not become a different kind of
    failure that hides the status.
    """
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
