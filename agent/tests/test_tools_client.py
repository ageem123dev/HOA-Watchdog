"""The only way this runtime obtains a fact.

AD-3: "It obtains every fact by calling Node's tool endpoints." AD-15: those
endpoints "are the sole data path in the system and must reject any caller that
is not the agent service."

So this client is the agent side of the wire story 3.2 built. Everything it does
is either presenting the token correctly or telling the truth about what came
back - and the second half matters more than it looks, because a caller that
turns a `401` into an empty result set converts "you are not authorised" into
"this unit owes nothing", which is a wrong answer with a confident face.

No network anywhere in this suite: the transport is a parameter.
"""

from __future__ import annotations

import json
import urllib.request

import pytest

from watchdog_agent.tools_client import (
    CatalogEntryNotFound,
    GatewayAuthError,
    GatewayError,
    InvalidRequest,
    MisconfiguredAgent,
    execute_catalog_entry,
)

TOKEN = "r7Qx-4kP9mVt2LbN8sYw0aZc"
BASE = "https://gateway.internal"
ACTOR = "018f3a2b-0000-7000-8000-0000000000aa"


class RecordingTransport:
    """Captures one request and replays a canned response."""

    def __init__(self, status: int, body: object, *, raw: str | None = None) -> None:
        self.status = status
        self._raw = raw if raw is not None else json.dumps(body)
        self.calls: list[dict] = []

    def __call__(self, method: str, url: str, headers: dict, body: str) -> tuple[int, str]:
        self.calls.append({"method": method, "url": url, "headers": headers, "body": body})
        return self.status, self._raw


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("GATEWAY_BASE_URL", BASE)


def _call(transport, **overrides):
    kwargs = {
        "entry_id": "dues_status",
        "version": 1,
        "parameters": {"unitNumber": "4B", "assessmentYear": 2026},
        "actor_id": ACTOR,
        "transport": transport,
    }
    kwargs.update(overrides)
    return execute_catalog_entry(**kwargs)


class TestTheOrdinaryCase:
    def test_returns_the_rows_and_the_provenance_id(self) -> None:
        transport = RecordingTransport(200, {"provenanceId": "prov-1", "rows": [{"unitNumber": "4B"}]})

        result = _call(transport)

        assert result.provenance_id == "prov-1"
        assert result.rows == [{"unitNumber": "4B"}]

    def test_presents_the_token_as_a_bearer_credential(self) -> None:
        transport = RecordingTransport(200, {"provenanceId": "p", "rows": []})

        _call(transport)

        assert transport.calls[0]["headers"]["Authorization"] == f"Bearer {TOKEN}"

    def test_posts_the_request_to_the_versioned_tool_endpoint(self) -> None:
        transport = RecordingTransport(200, {"provenanceId": "p", "rows": []})

        _call(transport)

        call = transport.calls[0]
        assert call["method"] == "POST"
        assert call["url"] == f"{BASE}/tools/v1/catalog/execute"
        assert json.loads(call["body"]) == {
            "entryId": "dues_status",
            "version": 1,
            "parameters": {"unitNumber": "4B", "assessmentYear": 2026},
            "actorId": ACTOR,
        }


class TestFailsClosedOnMisconfiguration:
    """AC4. The failure belongs where the missing variable is.

    Sending the request anyway and letting the gateway answer 401 "works" - the
    caller still gets an error. But the diagnostic lands in the wrong place: the
    gateway's log fills with rejected callers that are actually its own agent,
    misdeployed, and that is indistinguishable from someone probing the endpoint.
    """

    def test_refuses_without_a_token_and_never_calls_the_transport(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("AGENT_SERVICE_TOKEN", raising=False)
        transport = RecordingTransport(200, {"provenanceId": "p", "rows": []})

        with pytest.raises(MisconfiguredAgent, match="AGENT_SERVICE_TOKEN"):
            _call(transport)

        assert transport.calls == []

    def test_refuses_a_blank_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("AGENT_SERVICE_TOKEN", "   ")
        transport = RecordingTransport(200, {"provenanceId": "p", "rows": []})

        with pytest.raises(MisconfiguredAgent):
            _call(transport)

        assert transport.calls == []

    def test_refuses_without_a_gateway_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GATEWAY_BASE_URL", raising=False)
        transport = RecordingTransport(200, {"provenanceId": "p", "rows": []})

        with pytest.raises(MisconfiguredAgent, match="GATEWAY_BASE_URL"):
            _call(transport)

        assert transport.calls == []

    @pytest.mark.parametrize(
        "url",
        [
            "http://gateway.internal",
            "ftp://gateway.internal",
            "file:///etc/passwd",
            "https:///no-host",
            "gateway.internal",
        ],
    )
    def test_refuses_a_gateway_url_that_is_not_absolute_https(
        self, monkeypatch: pytest.MonkeyPatch, url: str
    ) -> None:
        """The token only travels over TLS, to a host that was named.

        `urllib` opens `http:`, `ftp:` and `file:` quite happily. An `http://`
        gateway would send `AGENT_SERVICE_TOKEN` in clear - and that token is the
        whole boundary between the internet and the catalog until the private
        network exists. Raised by CodeRabbit on MR !39.
        """
        monkeypatch.setenv("GATEWAY_BASE_URL", url)
        transport = RecordingTransport(200, {"provenanceId": "p", "rows": []})

        with pytest.raises(MisconfiguredAgent):
            _call(transport)

        assert transport.calls == []


class TestSurfacesTheGatewaysRefusal:
    """AC5. A non-2xx is never an empty result set."""

    def test_401_raises_an_auth_error(self) -> None:
        transport = RecordingTransport(401, {"code": "unauthenticated", "message": "no"})

        with pytest.raises(GatewayAuthError) as raised:
            _call(transport)

        assert raised.value.code == "unauthenticated"

    def test_404_raises_entry_not_found(self) -> None:
        transport = RecordingTransport(404, {"code": "unknown_entry", "message": "no such entry"})

        with pytest.raises(CatalogEntryNotFound) as raised:
            _call(transport)

        assert raised.value.code == "unknown_entry"

    @pytest.mark.parametrize("code", ["invalid_request", "invalid_parameters"])
    def test_400_raises_invalid_request(self, code: str) -> None:
        transport = RecordingTransport(400, {"code": code, "message": "bad"})

        with pytest.raises(InvalidRequest) as raised:
            _call(transport)

        assert raised.value.code == code

    def test_500_raises_a_gateway_error_carrying_the_status(self) -> None:
        transport = RecordingTransport(500, {"code": "internal", "message": "nope"})

        with pytest.raises(GatewayError) as raised:
            _call(transport)

        assert raised.value.status == 500

    def test_a_non_json_error_body_still_raises_rather_than_crashing(self) -> None:
        transport = RecordingTransport(502, None, raw="<html>bad gateway</html>")

        with pytest.raises(GatewayError) as raised:
            _call(transport)

        assert raised.value.status == 502

    def test_no_error_is_silently_converted_to_an_empty_result(self) -> None:
        """The failure this whole class exists for.

        A caller that returns `[]` on a 401 turns "you are not authorised" into
        "this unit owes nothing" - a wrong financial answer, delivered
        confidently, which is the exact outcome this product exists to prevent.
        """
        for status in (400, 401, 403, 404, 500, 502, 503):
            transport = RecordingTransport(status, {"code": "x", "message": "y"})
            with pytest.raises(GatewayError):
                _call(transport)


class TestAMalformedSuccess:
    def test_a_2xx_without_rows_is_an_error_not_an_empty_answer(self) -> None:
        transport = RecordingTransport(200, {"provenanceId": "p"})

        with pytest.raises(GatewayError, match="rows"):
            _call(transport)

    def test_a_2xx_without_a_provenance_id_is_an_error(self) -> None:
        """AD-12 makes the provenance id part of the answer's meaning.

        A result with no provenance id came from a path that did not log, or from
        something that is not the gateway. Either way it is not an answer.
        """
        transport = RecordingTransport(200, {"rows": []})

        with pytest.raises(GatewayError, match="provenanceId"):
            _call(transport)

    def test_a_2xx_that_is_not_json_is_an_error(self) -> None:
        transport = RecordingTransport(200, None, raw="not json at all")

        with pytest.raises(GatewayError):
            _call(transport)

    def test_rows_that_are_not_a_list_is_an_error(self) -> None:
        """The guard existed and nothing exercised it. Raised by CodeRabbit."""
        transport = RecordingTransport(200, {"provenanceId": "p", "rows": {"unitNumber": "4B"}})

        with pytest.raises(GatewayError, match="list"):
            _call(transport)

    @pytest.mark.parametrize("provenance", [None, "", "   ", 42])
    def test_a_provenance_id_that_identifies_nothing_is_an_error(self, provenance: object) -> None:
        """`str(None)` is `'None'` — an id that looks like one and is not.

        AD-12 makes the provenance id part of what an answer means, so coercing
        whatever arrived into a string would hand the caller a receipt for a
        query nobody can find.
        """
        transport = RecordingTransport(200, {"provenanceId": provenance, "rows": []})

        with pytest.raises(GatewayError, match="provenanceId"):
            _call(transport)


class TestTheGatewayIsUnreachable:
    """A connection that never became an answer is still this client's problem.

    `urllib` raises `URLError` for DNS failure and refused connections and
    `TimeoutError` on timeout, and neither carries a status. Letting them escape
    means a caller that correctly handles `GatewayError` still dies on a network
    blip. Raised by CodeRabbit on the local round.

    **The wrapping lives in the shipped transport, not in `execute_catalog_entry`.**
    A first draft asserted that *any* transport raising anything became a
    `GatewayError`, and that was the wrong design to test into existence:
    `Transport`'s contract is to return `(status, body)`, so catching everything
    a substituted transport throws would turn a `TypeError` in a bad stub into a
    plausible-looking network error and hide the bug. The specific urllib
    exceptions are known where urllib is used, and that is where they are caught.
    """

    def test_the_opener_carries_no_proxy_handler(self) -> None:
        """`build_opener` adds a ProxyHandler that reads HTTPS_PROXY.

        An ambient proxy variable would route this authenticated request - bearer
        token included - through whatever it names. The gateway's address is
        configuration; nothing else gets to redirect it. Raised by CodeRabbit.
        """
        from watchdog_agent import tools_client

        source = __import__("inspect").getsource(tools_client._urllib_transport)

        assert "ProxyHandler({})" in source

    def test_the_real_transport_wraps_a_url_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Against the shipped transport, not a stub — the wrapping is there.

        `monkeypatch` rather than a manual save-and-restore: it undoes the patch
        even if the assertion raises, so a failure here cannot leave `urlopen`
        replaced for every test that runs afterwards. Raised by Argus.
        """
        import urllib.error

        from watchdog_agent import tools_client

        def explode(*args: object, **kwargs: object) -> None:
            raise urllib.error.URLError("name or service not known")

        # `OpenerDirector.open`, not `urllib.request.urlopen`. The transport
        # builds its own opener (for the empty ProxyHandler and the redirect
        # refusal), so `urlopen` is no longer on the path — patching it left this
        # test making a **real DNS lookup** to `nowhere.invalid` and passing
        # because that failed, which is not what it claims to prove. It also took
        # 11 of the suite's 11.25 seconds, a signal that was visible in every run
        # and that I did not act on. Raised by CodeRabbit on MR !39.
        monkeypatch.setattr(urllib.request.OpenerDirector, "open", explode)

        with pytest.raises(GatewayError) as raised:
            tools_client._urllib_transport("POST", "https://nowhere.invalid", {}, "{}")

        assert raised.value.status == 0
