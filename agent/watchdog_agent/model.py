"""The reasoning model, and the one line that would collapse AD-10.

AD-11 binds the model by capability rather than by name: it "must support strict
tool use and schema-validated structured outputs". `gemini-3.6-flash` is the
current binding (spine Stack, 2026-08-10), and the id is a variable so changing
it is configuration rather than a code edit — the same pattern
`GEMINI_OCR_MODEL` established on the extraction side.

## The credential, which is the whole of AD-10 now

AD-10 used to be a *vendor* boundary. That clause was withdrawn on 2026-08-10
when reasoning moved to Gemini, so extraction and reasoning are one vendor and
**credential separation is all that is left of the boundary**.

CrewAI's native Gemini provider will pick a key up from the environment if it is
not handed one, and it prefers `GOOGLE_API_KEY` over `GEMINI_API_KEY`. Verified
against the installed package, which announces it on stdout:

    Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.

`GEMINI_API_KEY` is the *extraction* credential, held by the `web` deploy unit.
So the key is read from `REASONING_API_KEY` and passed **explicitly**, and the
service never names the other two at all. `tests/test_no_data_credentials.py`
asserts the read set exhaustively, which is what turns that from a convention
into a failing test.

An absent `REASONING_API_KEY` is a refusal here rather than a silent fallback to
whatever the environment happens to hold — the same fail-closed reasoning
`tools_client.py` applies to an absent service token. A fallback that finds a
*set* variable is the dangerous case: it works, and it works with the wrong
credential.
"""

from __future__ import annotations

from typing import Any

from .routing import ToolChoice
from .tools_client import MisconfiguredAgent, _required

#: The reasoning credential. Deliberately not `GEMINI_API_KEY`, which belongs to
#: extraction, and deliberately not `GOOGLE_API_KEY`, which CrewAI would prefer
#: over it if either were present.
API_KEY_VARIABLE = "REASONING_API_KEY"

#: Which model, by variable, per AD-11's "the specific model id is seed, not
#: invariant".
MODEL_VARIABLE = "REASONING_MODEL"

#: The spine's current binding, used when the variable is unset.
DEFAULT_MODEL = "gemini-3.6-flash"

#: CrewAI routes on a `provider/model` string. `gemini/` selects the native
#: google-genai provider — not litellm, which `crewai==1.15.8` does not install.
PROVIDER = "gemini"


def reasoning_llm(model: str | None = None) -> Any:
    """The configured model client, with its key passed rather than discovered."""
    api_key = _required(API_KEY_VARIABLE)

    import os

    chosen = model or os.environ.get(MODEL_VARIABLE) or DEFAULT_MODEL
    if chosen.strip() == "":
        raise MisconfiguredAgent(f"{MODEL_VARIABLE} is set to a blank value")

    # Imported here rather than at module scope: `crewai` pulls chromadb,
    # onnxruntime and several hundred other modules, and every caller that is not
    # actually talking to a model substitutes this seam.
    from crewai import LLM

    return LLM(model=f"{PROVIDER}/{chosen}", api_key=api_key)


def choose_with_gemini(
    question: str,
    declarations: list[dict[str, Any]],
    *,
    llm: Any | None = None,
) -> ToolChoice | None:
    """Ask the model which entry answers this question.

    Returns `None` when it answered with prose instead of calling a tool.
    `routing.route_question` turns that into `ModelChoseNothing`, because the
    provider cannot express Gemini's `tool_config.mode = ANY` — see that module's
    header for what was verified and why this is the stronger half.

    **The recorded call is the return value, and nothing is executed here.** Each
    declaration is bound to a recorder rather than to `execute_catalog_entry`, so
    a model that calls a tool has expressed a *choice* and not caused a query.
    The choice is then validated against the catalog before anything runs.
    """
    recorder = _ChoiceRecorder()
    client = llm if llm is not None else reasoning_llm()

    client.call(
        _PROMPT.format(question=question),
        tools=declarations,
        available_functions={
            declaration["name"]: recorder.for_tool(declaration["name"])
            for declaration in declarations
        },
    )

    return recorder.choice


class _ChoiceRecorder:
    """Captures the first tool call, and ignores any after it.

    One question is one catalog execution. A model that called two tools has
    misunderstood the contract, and answering from the first is the conservative
    reading — the alternative is executing both and deciding afterwards which
    answer to show, which is two provenance rows for one question.
    """

    def __init__(self) -> None:
        self.choice: ToolChoice | None = None

    def for_tool(self, name: str):
        def record(**arguments: Any) -> str:
            if self.choice is None:
                self.choice = ToolChoice(name=name, arguments=dict(arguments))
            return "recorded"

        return record


_PROMPT = (
    "You answer questions about a homeowners association's records by choosing "
    "exactly one of the tools you have been given and supplying its parameters. "
    "You cannot answer from your own knowledge and you cannot write a query. If "
    "no tool fits the question, do not guess at one.\n\n"
    "Question: {question}"
)
