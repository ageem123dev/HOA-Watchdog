"""The reasoning credential, and the one line that would collapse AD-10.

AD-10's vendor clause was withdrawn on 2026-08-10 when reasoning moved to
Gemini. Extraction and reasoning are one vendor now, so **credential separation
is the entire boundary** — `deploy-units.json` declares `GEMINI_API_KEY` on one
side and `REASONING_API_KEY` on the other, and `shared-credential` in
`core/security/dual-llm-boundary.ts` is the clause carrying it.

CrewAI will pick a key up from the environment if it is not handed one, and it
prefers `GOOGLE_API_KEY` over `GEMINI_API_KEY`. That is not a documentation
claim: the tests below plant both and assert what the constructed client
actually holds.

`test_no_data_credentials.py` asserts the read set exhaustively, which catches a
*new* variable. These tests catch the subtler thing it cannot see — a library
reading a variable this code never names.
"""

from __future__ import annotations

import pytest

from watchdog_agent.model import (
    API_KEY_VARIABLE,
    DEFAULT_MODEL,
    MODEL_VARIABLE,
    choose_with_gemini,
    reasoning_llm,
)
from watchdog_agent.routing import ToolChoice
from watchdog_agent.tools_client import MisconfiguredAgent

OURS = "reasoning-key-9f2a"
EXTRACTIONS = "extraction-key-must-never-be-used"

DECLARATION = {
    "name": "dues_status",
    "description": "What one unit owes for one assessment year.",
    "parameters": {
        "type": "object",
        "properties": {"unitNumber": {"type": "string", "description": "The unit."}},
        "required": ["unitNumber"],
        "additionalProperties": False,
    },
}


@pytest.fixture(autouse=True)
def _no_ambient_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test states its own environment. None inherits the developer's."""
    for variable in (
        API_KEY_VARIABLE,
        MODEL_VARIABLE,
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
        # The gateway pair too. `test_nothing_is_executed_by_calling_a_tool`
        # claims no execution can happen because these are unset — and the
        # fixture did not unset them, so on a developer machine that exports
        # them the stated precondition was simply false and the test would have
        # passed even if a tool call had reached the gateway. A guard that
        # depends on an ambient environment is not a guard. Raised by CodeRabbit
        # on MR !41.
        "AGENT_SERVICE_TOKEN",
        "GATEWAY_BASE_URL",
    ):
        monkeypatch.delenv(variable, raising=False)

    # AC8 — "no test in agent/tests/ makes a network call" — made true rather
    # than hoped for. CrewAI ships posthog telemetry and OpenTelemetry exporters
    # that fire on import and on use, so the file that constructs real CrewAI
    # objects is the one file where that claim could quietly stop holding.
    #
    # These tests are the slowest in the suite by a wide margin: ~5.5s to import
    # crewai and ~1.3s per LLM construction, measured. That is local work, not a
    # socket — checked, because story 3.3 shipped a test that passed by making a
    # real DNS lookup and took 11 of the suite's 11.25 seconds while looking
    # perfectly healthy.
    monkeypatch.setenv("CREWAI_DISABLE_TELEMETRY", "true")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")


class TestTheCredentialIsTheBoundary:
    def test_uses_the_reasoning_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(API_KEY_VARIABLE, OURS)

        assert reasoning_llm().api_key == OURS

    def test_does_not_fall_back_to_the_extraction_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The failure mode, planted.

        With `REASONING_API_KEY` absent and `GEMINI_API_KEY` present, a client
        that discovers its key from the environment would come up holding the
        extraction credential and *work* — which is the dangerous shape, because
        nothing fails and the boundary is simply gone.
        """
        monkeypatch.setenv("GEMINI_API_KEY", EXTRACTIONS)

        with pytest.raises(MisconfiguredAgent, match=API_KEY_VARIABLE):
            reasoning_llm()

    def test_does_not_fall_back_to_google_api_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`GOOGLE_API_KEY` is the one CrewAI prefers, so it is checked too."""
        monkeypatch.setenv("GOOGLE_API_KEY", EXTRACTIONS)

        with pytest.raises(MisconfiguredAgent, match=API_KEY_VARIABLE):
            reasoning_llm()

    def test_the_reasoning_key_wins_even_when_the_others_are_set(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The deployment this will actually meet, if anyone co-locates the two.

        Passing `api_key` explicitly is what makes this true. Constructed without
        it, CrewAI reports `Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using
        GOOGLE_API_KEY.` and holds the wrong credential.
        """
        monkeypatch.setenv(API_KEY_VARIABLE, OURS)
        monkeypatch.setenv("GEMINI_API_KEY", EXTRACTIONS)
        monkeypatch.setenv("GOOGLE_API_KEY", EXTRACTIONS)

        assert reasoning_llm().api_key == OURS

    @pytest.mark.parametrize("blank", ["", "   "])
    def test_a_blank_reasoning_key_is_refused(
        self, monkeypatch: pytest.MonkeyPatch, blank: str
    ) -> None:
        monkeypatch.setenv(API_KEY_VARIABLE, blank)

        with pytest.raises(MisconfiguredAgent):
            reasoning_llm()


class TestWhichModel:
    def test_defaults_to_the_spine_binding(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(API_KEY_VARIABLE, OURS)

        assert reasoning_llm().model == DEFAULT_MODEL

    def test_the_default_is_the_id_the_architecture_names(self) -> None:
        # The spine's Stack table, 2026-08-10. Pinned so a drift between the
        # architecture and this constant is a failing test rather than a
        # discrepancy nobody reads.
        assert DEFAULT_MODEL == "gemini-3.6-flash"

    def test_the_model_is_selected_by_variable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """AD-11: the specific model id is seed, not invariant."""
        monkeypatch.setenv(API_KEY_VARIABLE, OURS)
        monkeypatch.setenv(MODEL_VARIABLE, "gemini-3.5-flash-lite")

        assert reasoning_llm().model == "gemini-3.5-flash-lite"

    @pytest.mark.parametrize("blank", ["", "   ", "	"])
    def test_a_blank_model_variable_is_refused_rather_than_defaulted(
        self, monkeypatch: pytest.MonkeyPatch, blank: str
    ) -> None:
        """A blank value is a broken deployment, not an unset one.

        Falling back to the default here would run a model nobody chose, under a
        configuration that says something else.

        **The empty string is the case that shipped broken.** The first version
        read `model or os.environ.get(...) or DEFAULT_MODEL`, and `""` is falsy —
        so it fell straight through to the default while `"   "` was caught. The
        parametrized list covered `"   "` and not `""`, which is exactly the gap
        it existed to close. Raised by Argus.
        """
        monkeypatch.setenv(API_KEY_VARIABLE, OURS)
        monkeypatch.setenv(MODEL_VARIABLE, blank)

        with pytest.raises(MisconfiguredAgent, match=MODEL_VARIABLE):
            reasoning_llm()

    def test_routes_to_the_native_provider_not_litellm(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`crewai==1.15.8` installs no litellm; `gemini/` selects google-genai.

        Asserted because the failure is an `ImportError` at the first real call,
        which is a long way from the line that chose the provider string.
        """
        monkeypatch.setenv(API_KEY_VARIABLE, OURS)

        assert reasoning_llm().is_litellm is False


class RecordingLLM:
    """Stands in for the model. Calls whichever tool it was told to."""

    def __init__(self, calls: list[tuple[str, dict]] | None = None) -> None:
        self.calls = calls or []
        self.seen: dict = {}

    def call(self, messages, tools=None, available_functions=None, **_: object) -> str:
        self.seen = {"messages": messages, "tools": tools}
        for name, arguments in self.calls:
            available_functions[name](**arguments)
        return "done"


class TestTurningAModelCallIntoAChoice:
    def test_a_tool_call_becomes_a_choice(self) -> None:
        llm = RecordingLLM([("dues_status", {"unitNumber": "4B"})])

        choice = choose_with_gemini("What does 4B owe?", [DECLARATION], llm=llm)

        assert choice == ToolChoice("dues_status", {"unitNumber": "4B"})

    def test_prose_instead_of_a_call_is_no_choice(self) -> None:
        """Which `route_question` turns into `ModelChoseNothing`."""
        assert choose_with_gemini("Hello", [DECLARATION], llm=RecordingLLM()) is None

    def test_the_first_call_wins_when_a_model_calls_twice(self) -> None:
        """One question is one execution, and one provenance row."""
        llm = RecordingLLM(
            [("dues_status", {"unitNumber": "4B"}), ("dues_status", {"unitNumber": "9C"})]
        )

        choice = choose_with_gemini("...", [DECLARATION], llm=llm)

        assert choice is not None and choice.arguments == {"unitNumber": "4B"}

    def test_the_declarations_are_handed_over_unchanged(self) -> None:
        llm = RecordingLLM()

        choose_with_gemini("...", [DECLARATION], llm=llm)

        assert llm.seen["tools"] == [DECLARATION]

    def test_the_question_reaches_the_model(self) -> None:
        llm = RecordingLLM()

        choose_with_gemini("What does 4B owe for 2026?", [DECLARATION], llm=llm)

        assert "What does 4B owe for 2026?" in llm.seen["messages"]

    def test_nothing_is_executed_by_calling_a_tool(self) -> None:
        """A tool call is a *choice*, not a query.

        Each declaration is bound to a recorder rather than to
        `execute_catalog_entry`, so a model that calls a tool has expressed an
        intention and caused nothing. Validation happens after, against the
        catalog.
        """
        llm = RecordingLLM([("dues_status", {"unitNumber": "4B"})])

        # No transport is configured and no gateway variables are set; if calling
        # a tool executed anything, this would raise rather than return a choice.
        assert choose_with_gemini("...", [DECLARATION], llm=llm) is not None
