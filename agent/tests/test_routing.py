"""The model picks an entry, and cannot pick anything else.

The epic's claim for story 3.4 is `Intent routing with strict tool use; no
model-authored SQL is possible`. Everything the model is allowed to influence is
here: which entry, and what parameters. Everything else — the SQL, the bind
order, the version, whether a provenance row is written — is decided by code it
cannot reach.

**Forced tool use is enforced here rather than by the API, and that is a
correction to the story rather than a shortcut.** AC4 assumed Gemini's
`tool_config.function_calling_config.mode = ANY` would be reachable. It is not:
CrewAI 1.15.8's native Gemini provider assembles `GenerateContentConfig` from a
fixed list of fields, carries no `tool_config`, and passes no `additional_params`
through. So a model *can* answer with prose instead of calling a tool, and what
this module does is refuse to turn that into an answer. That is the stronger
half anyway — `mode = ANY` is a request to the model, while
`ModelChoseNothing` is a property of this code — and it holds even on the
documented ANY-mode failures where the API rejects the request outright.

No network anywhere in this file: the chooser is a parameter, exactly as the
transport is.
"""

from __future__ import annotations

import json

import pytest

from watchdog_agent.catalog_client import MalformedCatalog
from watchdog_agent.routing import (
    ModelChoseNothing,
    ModelChoseUnknownEntry,
    RoutedAnswer,
    ToolChoice,
    route_question,
)
from watchdog_agent.tools_client import GatewayAuthError, InvalidRequest

TOKEN = "r7Qx-4kP9mVt2LbN8sYw0aZc"
BASE = "https://gateway.internal"
#: Opaque to this runtime by design. AD-18: the Node gateway mints it and the
#: Node gateway verifies it. Nothing here knows what is inside, and nothing here
#: could produce a different one — a uuid-shaped constant would quietly suggest
#: this side still handles an identity rather than a token it is carrying.
ASSERTION = "eyJzdWIiOiI0YiJ9.p7Xk2QvT9mLzR0hCwYbN8sJdA5gFuE1oKiVtHnMqPcw"

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

PARAMETERS = {"unitNumber": "4B", "assessmentYear": 2026}


class ScriptedGateway:
    """Answers the catalog request, then the execute request."""

    def __init__(
        self,
        *,
        entries: list[dict] | None = None,
        execute_status: int = 200,
        execute_body: object | None = None,
    ) -> None:
        self.entries = [ENTRY] if entries is None else entries
        self.execute_status = execute_status
        self.execute_body = (
            {"provenanceId": "prov-1", "rows": [{"unitNumber": "4B"}]}
            if execute_body is None
            else execute_body
        )
        self.calls: list[dict] = []

    def __call__(self, method: str, url: str, headers: dict, body: str) -> tuple[int, str]:
        self.calls.append({"method": method, "url": url, "body": body})

        if url.endswith("/tools/v1/catalog"):
            return 200, json.dumps({"entries": self.entries})

        return self.execute_status, json.dumps(self.execute_body)

    @property
    def executions(self) -> list[dict]:
        return [json.loads(c["body"]) for c in self.calls if c["url"].endswith("/execute")]


def chooser_returning(choice: ToolChoice | None):
    """A stub model. Records what it was shown, returns what it was told to."""

    def chooser(question: str, declarations: list[dict]) -> ToolChoice | None:
        chooser.seen = {"question": question, "declarations": declarations}  # type: ignore[attr-defined]
        return choice

    chooser.seen = None  # type: ignore[attr-defined]
    return chooser


@pytest.fixture(autouse=True)
def _configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_SERVICE_TOKEN", TOKEN)
    monkeypatch.setenv("GATEWAY_BASE_URL", BASE)


def _route(chooser, transport=None, question: str = "What does 4B owe for 2026?"):
    return route_question(
        question,
        actor_assertion=ASSERTION,
        chooser=chooser,
        transport=transport or ScriptedGateway(),
    )


class TestTheOrdinaryCase:
    def test_executes_the_entry_the_model_chose(self) -> None:
        gateway = ScriptedGateway()

        answer = _route(chooser_returning(ToolChoice("dues_status", PARAMETERS)), gateway)

        assert isinstance(answer, RoutedAnswer)
        assert (answer.entry_id, answer.version) == ("dues_status", 1)
        assert answer.parameters == PARAMETERS

    def test_returns_the_rows_and_the_provenance_id(self) -> None:
        answer = _route(chooser_returning(ToolChoice("dues_status", PARAMETERS)))

        assert answer.rows == [{"unitNumber": "4B"}]
        assert answer.provenance_id == "prov-1"

    def test_sends_exactly_what_the_model_chose_to_the_gateway(self) -> None:
        gateway = ScriptedGateway()

        _route(chooser_returning(ToolChoice("dues_status", PARAMETERS)), gateway)

        assert gateway.executions == [
            {
                "entryId": "dues_status",
                "version": 1,
                "parameters": PARAMETERS,
                "actorAssertion": ASSERTION,
            }
        ]

    def test_shows_the_model_the_question_and_the_declarations(self) -> None:
        chooser = chooser_returning(ToolChoice("dues_status", PARAMETERS))

        _route(chooser, question="What does 4B owe?")

        assert chooser.seen["question"] == "What does 4B owe?"
        assert [d["name"] for d in chooser.seen["declarations"]] == ["dues_status"]


class TestTheVersionIsNotTheModelsToChoose:
    """AD-14 versioning is operational, and a stale pick is a silent wrong answer."""

    def test_the_version_comes_from_the_catalog_not_from_the_model(self) -> None:
        gateway = ScriptedGateway(entries=[ENTRY, {**ENTRY, "version": 3}])

        answer = _route(chooser_returning(ToolChoice("dues_status", PARAMETERS)), gateway)

        assert answer.version == 3
        assert gateway.executions[0]["version"] == 3

    def test_the_declarations_carry_no_version_for_the_model_to_read(self) -> None:
        chooser = chooser_returning(ToolChoice("dues_status", PARAMETERS))

        _route(chooser)

        assert "version" not in chooser.seen["declarations"][0]


class TestAD5NoModelAuthoredSQL:
    def test_the_model_is_shown_no_sql(self) -> None:
        chooser = chooser_returning(ToolChoice("dues_status", PARAMETERS))

        _route(chooser)

        shown = json.dumps(chooser.seen["declarations"]).lower()
        for keyword in ["select ", " from ", " where ", "sql"]:
            assert keyword not in shown

    def test_a_sql_parameter_the_model_invents_never_reaches_the_gateway(self) -> None:
        """The claim is structural: there is no field for it.

        The gateway's `validateParameters` refuses an undeclared property too,
        and that is the enforcement of record. This asserts the agent does not
        forward it in the first place, so the refusal does not depend on a round
        trip.
        """
        gateway = ScriptedGateway()
        smuggled = {**PARAMETERS, "sql": "drop table payment"}

        with pytest.raises(InvalidRequest, match="sql"):
            _route(chooser_returning(ToolChoice("dues_status", smuggled)), gateway)

        assert gateway.executions == []


class TestForcedToolUseIsEnforcedHere:
    """AC4, corrected. The provider cannot express `mode = ANY`, so this does.

    `crewai==1.15.8`'s Gemini provider builds `GenerateContentConfig` from a
    fixed field list with no `tool_config` and no `additional_params`
    passthrough. Verified against the installed package, not the documentation.
    """

    def test_a_model_that_answers_with_prose_is_an_error(self) -> None:
        with pytest.raises(ModelChoseNothing):
            _route(chooser_returning(None))

    def test_a_model_that_chose_nothing_never_reaches_the_gateway(self) -> None:
        gateway = ScriptedGateway()

        with pytest.raises(ModelChoseNothing):
            _route(chooser_returning(None), gateway)

        assert gateway.executions == []

    def test_the_refusal_is_not_an_empty_answer(self) -> None:
        """The failure this whole class exists for.

        A router that returned zero rows when the model would not choose turns
        "I could not understand the question" into "this unit owes nothing" —
        a wrong financial answer with a confident face.
        """
        try:
            _route(chooser_returning(None))
        except ModelChoseNothing as raised:
            assert "chose no" in str(raised) or "no tool" in str(raised)
        else:
            pytest.fail("a model that chose nothing produced an answer")


class TestAChoiceTheCatalogDoesNotAccept:
    def test_an_entry_the_catalog_does_not_hold_raises(self) -> None:
        with pytest.raises(ModelChoseUnknownEntry, match="drop_everything"):
            _route(chooser_returning(ToolChoice("drop_everything", {})))

    def test_an_unknown_entry_never_reaches_the_gateway(self) -> None:
        """Refused before the round trip, so nothing writes a provenance row.

        The gateway would answer 404, and that would be correct — but a
        provenance log filling with entries that do not exist is noise in the
        one record a board member is meant to be able to read.
        """
        gateway = ScriptedGateway()

        with pytest.raises(ModelChoseUnknownEntry):
            _route(chooser_returning(ToolChoice("drop_everything", {})), gateway)

        assert gateway.executions == []

    def test_parameters_the_entry_rejects_surface_rather_than_being_swallowed(self) -> None:
        """The *gateway's* refusal, not this module's.

        **This test was vacuous and Argus caught it.** It supplied only
        `unitNumber`, so `_checked_parameters` raised on the missing required
        `assessmentYear` and the mocked gateway was never called — it asserted
        the pre-flight check while claiming to assert error propagation, and it
        would have passed with the propagation deleted.

        Both required parameters are supplied now, with a wrong *type*. Types are
        deliberately not checked locally (that would be a second statement of the
        entry's schema), so this reaches the gateway, which is the point. The
        call count is asserted, because "it raised" is not evidence of *where*.
        """
        gateway = ScriptedGateway(
            execute_status=400, execute_body={"code": "invalid_parameters", "message": "no"}
        )
        wrong_type = {"unitNumber": 4, "assessmentYear": 2026}

        with pytest.raises(InvalidRequest):
            _route(chooser_returning(ToolChoice("dues_status", wrong_type)), gateway)

        assert gateway.executions == [
            {
                "entryId": "dues_status",
                "version": 1,
                "parameters": wrong_type,
                "actorAssertion": ASSERTION,
            }
        ]

    def test_a_missing_required_parameter_is_refused_before_the_round_trip(self) -> None:
        gateway = ScriptedGateway()

        with pytest.raises(InvalidRequest, match="assessmentYear"):
            _route(chooser_returning(ToolChoice("dues_status", {"unitNumber": "4B"})), gateway)

        assert gateway.executions == []


class TestTheCatalogItselfFailing:
    def test_an_unauthenticated_catalog_request_raises_before_any_model_call(self) -> None:
        """The model is never asked a question the system cannot answer."""

        def gateway(method: str, url: str, headers: dict, body: str) -> tuple[int, str]:
            return 401, json.dumps({"code": "unauthenticated", "message": "no"})

        chooser = chooser_returning(ToolChoice("dues_status", PARAMETERS))

        with pytest.raises(GatewayAuthError):
            _route(chooser, gateway)

        assert chooser.seen is None

    def test_a_malformed_catalog_raises_before_any_model_call(self) -> None:
        def gateway(method: str, url: str, headers: dict, body: str) -> tuple[int, str]:
            return 200, json.dumps({"entries": []})

        chooser = chooser_returning(ToolChoice("dues_status", PARAMETERS))

        with pytest.raises(MalformedCatalog):
            _route(chooser, gateway)

        assert chooser.seen is None
