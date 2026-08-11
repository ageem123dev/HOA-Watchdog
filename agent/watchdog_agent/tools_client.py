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
import urllib.parse
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


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    """A tool endpoint does not redirect, and following one would leak the token.

    Python's `HTTPRedirectHandler` **does not strip `Authorization` when it
    follows a redirect**, so a gateway URL that redirected — a misconfiguration,
    a hijacked DNS entry, an http→https upgrade to the wrong host — would send
    the bearer credential to wherever it pointed. That token is the entire
    boundary between the internet and the catalog until the private network
    exists, so it must not travel anywhere it was not addressed.

    Refusing is correct rather than merely safe: `/tools/v1/*` answers with a
    status and an envelope. A redirect from it is not a response this client
    should try to follow. Raised by CodeRabbit on MR !39.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        raise GatewayError(
            f"the gateway redirected to {newurl!r}; refusing to resend the service token",
            status=code,
        )


def _require_https(url: str) -> None:
    """The token only ever travels over TLS, to a host that was named.

    `urllib` will happily open `http:`, `ftp:` and `file:`, and a hostless
    `https:///x` besides. `GATEWAY_BASE_URL` is configuration, so a typo or a
    stale value is the realistic case rather than an attack - and an `http://`
    gateway sends `AGENT_SERVICE_TOKEN` in clear, which is the whole boundary
    until the private network exists. Raised by CodeRabbit on MR !39.
    """
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise MisconfiguredAgent(
            f"{GATEWAY_VARIABLE} must be an https URL; got scheme {parsed.scheme or 'none'!r}"
        )
    if not parsed.hostname:
        raise MisconfiguredAgent(f"{GATEWAY_VARIABLE} names no host: {url!r}")


def _urllib_transport(method: str, url: str, headers: dict[str, str], body: str) -> tuple[int, str]:
    request = urllib.request.Request(url, data=body.encode("utf-8"), headers=headers, method=method)
    # An **empty** ProxyHandler, which is not the default. `build_opener` adds one
    # that reads `HTTPS_PROXY` and friends from the environment, so an ambient
    # proxy variable would route this authenticated request - bearer token and
    # all - through whatever it names. The gateway's address is configuration;
    # nothing else gets to redirect it. Raised by CodeRabbit on MR !39.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _RefuseRedirects)
    try:
        with opener.open(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        # An HTTP error is an answer, not a transport failure - the body carries
        # the gateway's envelope and the status is what the mapping below needs.
        # Caught before URLError, which it subclasses.
        return error.code, error.read().decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        # A connection that never became an answer: DNS failure, refused
        # connection, timeout. Wrapped so a caller handling `GatewayError` sees
        # every way this call can fail rather than only the ones with a status
        # code - the raw exception would otherwise escape a correct `except`
        # clause and take the agent down. Status 0: there was no response.
        # Raised by CodeRabbit on the local round.
        raise GatewayError(f"could not reach the gateway: {error}", status=0) from error


_STATUS_ERRORS: dict[int, Callable[..., GatewayError]] = {
    400: InvalidRequest,
    401: GatewayAuthError,
    404: CatalogEntryNotFound,
}


def call_gateway(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    transport: Transport | None = None,
    refusal: str = "the gateway refused the request",
) -> tuple[int, Any]:
    """Present the token, call one `/tools/*` path, and return the decoded body.

    Everything both callers do identically, in one place: require the
    configuration *before* opening anything, insist on TLS, and turn any non-2xx
    into the right `GatewayError` subclass rather than into a plausible-looking
    empty answer.

    Returns the status alongside the decoded body. The status is carried rather
    than assumed: a caller that hardcoded `200` would misreport a `204` or `201`
    in the error it raises next, and an error that misdescribes what happened
    sends the reader somewhere else — the same fault the venv-mismatch message
    had on MR !39.

    Extracted when story 3.4 added a second caller. Two copies of this is how one
    of them grows a `try` that swallows a 401 — and "you are not authorised"
    becoming "there is nothing here" is the failure this client exists to
    prevent.
    """
    token = _required(TOKEN_VARIABLE)
    base_url = _required(GATEWAY_VARIABLE)
    _require_https(base_url)

    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"

    send = transport or _urllib_transport
    status, raw = send(
        method,
        f"{base_url.rstrip('/')}{path}",
        headers,
        "" if body is None else json.dumps(body),
    )

    payload = _decode(raw)

    if status < 200 or status >= 300:
        code = payload.get("code") if isinstance(payload, dict) else None
        raise _STATUS_ERRORS.get(status, GatewayError)(
            f"{refusal} with {status}",
            status=status,
            code=code if isinstance(code, str) else None,
        )

    return status, payload


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
    status, payload = call_gateway(
        "POST",
        TOOL_PATH,
        body={
            "entryId": entry_id,
            "version": version,
            "parameters": parameters,
            "actorId": actor_id,
        },
        transport=transport,
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

    # Checked rather than coerced. `str(None)` is `'None'` - a provenance id that
    # looks like one, satisfies every downstream type, and identifies nothing.
    # AD-12 makes this id part of what an answer means, so a null or blank one is
    # not a cosmetic problem. Raised by CodeRabbit on the local round.
    provenance_id = payload["provenanceId"]
    if not isinstance(provenance_id, str) or provenance_id.strip() == "":
        raise GatewayError(
            "the gateway returned a success whose provenanceId was not a non-empty string",
            status=status,
        )

    return CatalogExecution(provenance_id=provenance_id, rows=rows)


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
