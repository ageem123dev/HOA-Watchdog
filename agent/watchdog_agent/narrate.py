"""The sentence a board member reads, written from the rows and nothing else.

AD-3 puts this here rather than on the Node side: the gateway holds no model
credential and cannot write model prose. AD-7 then checks what comes back —
`core/answer/validate-answer.ts` refuses any numeral that is not in these rows,
and `groundedAnswer` retries rather than showing an ungrounded sentence.

**So this function is deliberately not trusted.** It is asked for prose, and the
prose is checked afterwards by code that cannot be talked out of it. That is
AD-7's whole argument — "prompt directives may remain as defence in depth but
carry no enforcement weight" — and the prompt below is exactly that: defence in
depth, carrying none.

The rows are passed as data, never interpolated as instructions (AD-8). They are
serialized as JSON in a single user turn, and the instruction to use only those
numbers is a request the validator does not rely on.
"""

from __future__ import annotations

import json
from typing import Any

from .routing import RoutedAnswer

_PROMPT = (
    "You answer a homeowners association board member's question using only the "
    "rows below. Every number you write must appear in them exactly as given; do "
    "not add, round, total or compare figures, and do not write a number that is "
    "not there. Answer in one or two plain sentences. If the rows do not answer "
    "the question, say so plainly without inventing a figure.\n\n"
    "Question: {question}\n\n"
    "Rows: {rows}"
)


def narrate_answer(*, question: str, routed: RoutedAnswer, llm: Any | None = None) -> str:
    """Ask the model to write the answer. Returns its text.

    `llm` is a parameter for the same reason `Transport` and `Chooser` are: the
    suite opens no socket, and the seam is where a test substitutes.
    """
    from .model import reasoning_llm

    client = llm if llm is not None else reasoning_llm()

    answer = client.call(
        _PROMPT.format(question=question, rows=json.dumps(routed.rows, default=str))
    )

    return answer if isinstance(answer, str) else ""
