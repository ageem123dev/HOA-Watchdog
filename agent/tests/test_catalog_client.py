"""How the reasoning side learns what it may ask for.

The catalog is TypeScript and this runtime is Python. The shortcut nobody is
taking is a dict of entry ids and parameter schemas written a second time here:
a stale parameter *name* would be a rejected request, and a stale parameter
*type* would be an accepted one, bound wrongly. So the catalog arrives over
AD-15's wire, and this module is the receiving half.

**The declarations are the AD-5 boundary, restated on this side.** The endpoint
is tested not to send SQL; this is tested not to accept it. Two independent
statements of "the model never sees SQL", either of which fails on its own — a
regression on the Node side shows up in this suite too, which is the point of
having it here rather than trusting the wire.

No network anywhere in this file: the transport is a parameter.
"""

from __future__ import annotations

import json

import pytest

from watchdog_agent.catalog_client import (
    CatalogEntryView,
    MalformedCatalog,
    declarations_for,
    fetch_catalog,
)
from watchdog_agent.tools_client import (
    CatalogEntryNotFound,
    GatewayAuthError,
    GatewayError,
    MisconfiguredAgent,
)

TOKEN = "r7Qx-4kP9mVt2LbN8sYw0aZc"
BASE = "https://gateway.internal"

ENTRY = {
    "id": "dues_status",
    "version": 1,
    "description": "What one unit owes for one assessment year.",
    "parameters": {
        "type": "object",
        "properties": {
            "unitNumber": {"type": "string", "description": "The unit, e.g. 4B."},
            "assessmentYear": {"type": "integer", "description": "The assessment year."},
        },
        "required": ["unitNumber", "assessmentYear"],
        "additionalProperties": False,
    },
}


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


def _ok(*entries: dict) -> RecordingTransport:
    return RecordingTransport(200, {"entries": list(entries)})


class TestFetchingTheCatalog:
    def test_returns_one_view_per_entry(self) -> None:
        entries = fetch_catalog(transport=_ok(ENTRY))

        assert [entry.id for entry in entries] == ["dues_status"]
        assert entries[0].version == 1
        assert entries[0].description == "What one unit owes for one assessment year."

    def test_asks_the_versioned_catalog_endpoint_with_the_token(self) -> None:
        transport = _ok(ENTRY)

        fetch_catalog(transport=transport)

        call = transport.calls[0]
        assert call["method"] == "GET"
        assert call["url"] == f"{BASE}/tools/v1/catalog"
        assert call["headers"]["Authorization"] == f"Bearer {TOKEN}"

    def test_refuses_without_a_token_and_never_calls_the_transport(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("AGENT_SERVICE_TOKEN", raising=False)
        transport = _ok(ENTRY)

        with pytest.raises(MisconfiguredAgent, match="AGENT_SERVICE_TOKEN"):
            fetch_catalog(transport=transport)

        assert transport.calls == []

    @pytest.mark.parametrize("url", ["http://gateway.internal", "file:///etc/passwd", "no-scheme"])
    def test_refuses_a_gateway_url_that_is_not_absolute_https(
        self, monkeypatch: pytest.MonkeyPatch, url: str
    ) -> None:
        monkeypatch.setenv("GATEWAY_BASE_URL", url)
        transport = _ok(ENTRY)

        with pytest.raises(MisconfiguredAgent):
            fetch_catalog(transport=transport)

        assert transport.calls == []


class TestARefusalIsNeverAnEmptyCatalog:
    """An empty catalog is indistinguishable from "you may ask nothing".

    A model handed zero tools cannot call one, and forced tool use then fails
    with an argument error rather than an authentication error - so the operator
    debugging it is looking in the wrong place entirely. The same reasoning
    `test_tools_client.py` applies to a 401 becoming an empty result set.
    """

    def test_401_raises_rather_than_returning_no_entries(self) -> None:
        transport = RecordingTransport(401, {"code": "unauthenticated", "message": "no"})

        with pytest.raises(GatewayAuthError):
            fetch_catalog(transport=transport)

    @pytest.mark.parametrize("status", [400, 403, 404, 500, 502, 503])
    def test_every_error_status_raises_rather_than_returning_a_catalog(
        self, status: int
    ) -> None:
        transport = RecordingTransport(status, {"code": "x", "message": "y"})

        with pytest.raises(GatewayError):
            fetch_catalog(transport=transport)

    def test_a_404_here_is_not_reported_as_a_missing_catalog_entry(self) -> None:
        """A 404 on *this* path means the endpoint is not there.

        `_STATUS_ERRORS` mapped 404 to `CatalogEntryNotFound`, which was right
        while `execute` was its only caller. Sharing `call_gateway` with the
        catalog request widened that: an undeployed route, a stale path in
        `GATEWAY_BASE_URL` or a proxy answering for something else would have
        told the reader the catalog holds no such entry, when the truth is the
        catalog endpoint is missing. Raised by CodeRabbit on the local round.
        """
        transport = RecordingTransport(404, {"code": "not_found", "message": "no route"})

        with pytest.raises(GatewayError) as raised:
            fetch_catalog(transport=transport)

        assert not isinstance(raised.value, CatalogEntryNotFound)
        assert raised.value.status == 404

    def test_a_non_json_body_raises(self) -> None:
        transport = RecordingTransport(200, None, raw="<html>hello</html>")

        with pytest.raises(GatewayError):
            fetch_catalog(transport=transport)

    def test_a_success_with_no_entries_key_raises(self) -> None:
        transport = RecordingTransport(200, {"catalog": []})

        with pytest.raises(MalformedCatalog, match="entries"):
            fetch_catalog(transport=transport)

    def test_an_empty_entry_list_raises_rather_than_answering_nothing(self) -> None:
        """A catalog with no entries is a broken deployment, not a valid state.

        There is at least one entry in the repository, so an empty list means the
        gateway is answering from somewhere the catalog is not - and the failure
        should say that rather than surfacing later as "the model would not call
        a tool".
        """
        with pytest.raises(MalformedCatalog):
            fetch_catalog(transport=_ok())


class TestAMalformedEntry:
    @pytest.mark.parametrize("missing", ["id", "version", "description", "parameters"])
    def test_an_entry_missing_a_field_raises(self, missing: str) -> None:
        entry = {key: value for key, value in ENTRY.items() if key != missing}

        with pytest.raises(MalformedCatalog, match=missing):
            fetch_catalog(transport=_ok(entry))

    @pytest.mark.parametrize("blank", ["", "   "])
    def test_a_blank_description_raises(self, blank: str) -> None:
        """A model picks on this text. An entry with none can only be chosen by accident."""
        with pytest.raises(MalformedCatalog, match="description"):
            fetch_catalog(transport=_ok({**ENTRY, "description": blank}))

    def test_a_version_that_is_not_an_integer_raises(self) -> None:
        with pytest.raises(MalformedCatalog, match="version"):
            fetch_catalog(transport=_ok({**ENTRY, "version": "1"}))

    def test_parameters_that_are_not_an_object_schema_raises(self) -> None:
        with pytest.raises(MalformedCatalog, match="parameters"):
            fetch_catalog(transport=_ok({**ENTRY, "parameters": {"type": "array"}}))

    def test_a_schema_that_permits_undeclared_properties_raises(self) -> None:
        """The Consistency Conventions: "A tool without both is not registered."

        `additionalProperties: false` is what makes a `sql` key the model invents
        refusable rather than forwarded, so an entry arriving without it is not
        registered here either.
        """
        loose = {**ENTRY["parameters"], "additionalProperties": True}

        with pytest.raises(MalformedCatalog, match="additionalProperties"):
            fetch_catalog(transport=_ok({**ENTRY, "parameters": loose}))


class TestAD5TheModelNeverSeesSQL:
    """The receiving half of the boundary `app/tools/v1/catalog/route.ts` builds.

    Two independent statements, either of which fails alone. If the projection on
    the Node side ever regressed, this suite goes red too - and it is the suite
    that runs next to the code handing declarations to a model.
    """

    def test_an_entry_carrying_sql_is_refused(self) -> None:
        with pytest.raises(MalformedCatalog, match="sql"):
            fetch_catalog(transport=_ok({**ENTRY, "sql": "select 1"}))

    def test_an_entry_carrying_a_bind_order_is_refused(self) -> None:
        with pytest.raises(MalformedCatalog, match="bind"):
            fetch_catalog(transport=_ok({**ENTRY, "bind": ["unitNumber"]}))

    def test_mutating_a_declaration_does_not_change_the_view(self) -> None:
        """The isolation the deep copy exists for, asserted rather than assumed.

        Declarations are handed to CrewAI, which is third-party code, and the
        view's schema is what `_checked_parameters` later validates the model's
        arguments against. Sharing one dict between them means a provider that
        normalises a schema in place moves the goalposts between the question and
        the check.

        **The first version of this fix copied only in `_view_of`**, which
        separated the view from the decoded payload and left `declarations_for`
        assigning `entry.parameters` by reference — so the declaration and the
        view were still one dict and the fix did not fix the thing it was for.
        Raised by Argus on the fix diff. This test is what would have caught it.
        """
        entries = fetch_catalog(transport=_ok(ENTRY))
        declarations = declarations_for(entries)

        declarations[0]["parameters"]["properties"]["injected"] = {"type": "string"}
        declarations[0]["parameters"]["additionalProperties"] = True

        assert "injected" not in entries[0].parameters["properties"]
        assert entries[0].parameters["additionalProperties"] is False

    def test_no_declaration_carries_sql(self) -> None:
        declarations = declarations_for(fetch_catalog(transport=_ok(ENTRY)))

        assert "sql" not in json.dumps(declarations).lower()


class TestTheDeclarationsHandedToTheModel:
    def test_one_declaration_per_entry_named_for_it(self) -> None:
        declarations = declarations_for(fetch_catalog(transport=_ok(ENTRY)))

        assert [declaration["name"] for declaration in declarations] == ["dues_status"]

    def test_the_declaration_carries_the_schema_verbatim(self) -> None:
        declarations = declarations_for(fetch_catalog(transport=_ok(ENTRY)))

        assert declarations[0]["parameters"] == ENTRY["parameters"]

    def test_the_declaration_carries_the_description_the_model_chooses_on(self) -> None:
        declarations = declarations_for(fetch_catalog(transport=_ok(ENTRY)))

        assert declarations[0]["description"] == ENTRY["description"]

    def test_declares_no_parameter_the_entry_did_not_declare(self) -> None:
        declarations = declarations_for(fetch_catalog(transport=_ok(ENTRY)))

        declared = set(declarations[0]["parameters"]["properties"])
        assert declared == set(ENTRY["parameters"]["properties"])

    def test_every_declaration_refuses_undeclared_properties(self) -> None:
        declarations = declarations_for(fetch_catalog(transport=_ok(ENTRY)))

        for declaration in declarations:
            assert declaration["parameters"]["additionalProperties"] is False

    def test_a_name_gemini_will_accept(self) -> None:
        """Function names are `[A-Za-z_][A-Za-z0-9_]*`; `verb_noun` ids already are.

        Asserted rather than assumed, because the failure is an INVALID_ARGUMENT
        from the API that reads like a code bug rather than like a naming rule.
        """
        import re

        for declaration in declarations_for(fetch_catalog(transport=_ok(ENTRY))):
            assert re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", declaration["name"])


class TestVersionsAreNotTheModelsBusiness:
    """AD-14 versioning is operational; intent routing is not where it belongs.

    Handing the model `dues_status@1` and `dues_status@2` as two tools asks it to
    choose between two spellings of one question, and the wrong choice is a
    silently stale answer. It gets one tool per id, and the agent supplies the
    version - which mirrors `currentVersionOf` on the Node side.
    """

    def test_one_declaration_per_id_even_when_two_versions_exist(self) -> None:
        v2 = {**ENTRY, "version": 2}

        declarations = declarations_for(fetch_catalog(transport=_ok(ENTRY, v2)))

        assert [declaration["name"] for declaration in declarations] == ["dues_status"]

    def test_the_highest_version_wins(self) -> None:
        v2 = {**ENTRY, "version": 2, "description": "The newer one."}

        entries = fetch_catalog(transport=_ok(ENTRY, v2))
        chosen = {entry.id: entry for entry in entries}

        assert chosen["dues_status"].version == 2

    def test_the_order_they_arrive_in_does_not_decide_it(self) -> None:
        v2 = {**ENTRY, "version": 2}

        newest_first = {entry.id: entry for entry in fetch_catalog(transport=_ok(v2, ENTRY))}

        assert newest_first["dues_status"].version == 2


class TestTheViewIsWhatTheExecutorNeeds:
    def test_a_view_carries_what_execute_catalog_entry_is_called_with(self) -> None:
        entry = fetch_catalog(transport=_ok(ENTRY))[0]

        assert isinstance(entry, CatalogEntryView)
        assert (entry.id, entry.version) == ("dues_status", 1)
