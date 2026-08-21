"""AD-17's wire, from the agent's side.

    "The Node gateway reaches the Python agent service through **versioned
    ``/chat/v*`` endpoints only**. The **request** carries a question and nothing
    else - no SQL, no rows, and no catalog entry id: naming the entry would move
    intent routing out of the model and quietly undo AD-5. The **response**
    carries the answer, the provenance id, and the rows the answer was drawn
    from."

The spine drew this edge on 2026-07-29 and nothing implemented it until now, so
this file is the first thing that makes ``NEXT -> PY`` real.

**The load-bearing clause is the one about the entry id.** A gateway that could
name the catalog entry would be choosing the query itself, and story 3.4's whole
argument - that a model picks from a fixed catalog and cannot author SQL - would
be true of a component nobody was watching. So a request carrying ``entryId`` is
refused *out loud*, not quietly ignored: a dropped field is indistinguishable
from a respected one at the call site.

No socket anywhere in this file. Starlette's ``TestClient`` drives the app
in-process, and the router and narrator are parameters the way every other
external call in this package is.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from watchdog_agent.chat_service import CHAT_PATH, TOKEN_VARIABLE, create_app
from watchdog_agent.routing import RoutedAnswer

TOKEN = "gw-8Kd2mZq7Rt4Xn0Lb"
#: Opaque to this runtime by design. AD-18: the Node gateway mints it and the
#: Node gateway verifies it. Nothing here knows what is inside, and nothing here
#: could produce a different one — a uuid-shaped constant would quietly suggest
#: this side still handles an identity rather than a token it is carrying.
ASSERTION = "eyJzdWIiOiI0YiJ9.p7Xk2QvT9mLzR0hCwYbN8sJdA5gFuE1oKiVtHnMqPcw"

ROUTED = RoutedAnswer(
    entry_id="dues_status",
    version=1,
    parameters={"unitNumber": "4B", "assessmentYear": 2026},
    provenance_id="prov-1",
    rows=[{"unitNumber": "4B", "balanceOutstanding": "240.00"}],
)


def a_client(
    *,
    route=lambda question, actor_assertion: ROUTED,
    narrate=lambda question, routed: "Unit 4B owes $240.00.",
    token: str | None = TOKEN,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    if token is None:
        monkeypatch.delenv(TOKEN_VARIABLE, raising=False)
    else:
        monkeypatch.setenv(TOKEN_VARIABLE, token)

    return TestClient(create_app(route=route, narrate=narrate))


def ask(client: TestClient, body: dict | None = None, *, bearer: str | None = TOKEN):
    headers = {} if bearer is None else {"Authorization": f"Bearer {bearer}"}
    payload = {"question": "What does 4B owe for 2026?", "actorAssertion": ASSERTION}
    if body is not None:
        payload = body
    return client.post(CHAT_PATH, json=payload, headers=headers)


class TestWhoMayAsk:
    """AC4. The private network AD-17 assumes does not exist yet either."""

    def test_serves_the_gateway(self, monkeypatch: pytest.MonkeyPatch) -> None:
        assert ask(a_client(monkeypatch=monkeypatch)).status_code == 200

    def test_refuses_a_caller_with_no_authorization_header(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        response = ask(a_client(monkeypatch=monkeypatch), bearer=None)

        assert response.status_code == 401
        assert response.json()["code"] == "unauthenticated"

    def test_refuses_a_wrong_token(self, monkeypatch: pytest.MonkeyPatch) -> None:
        assert ask(a_client(monkeypatch=monkeypatch), bearer="not-the-token").status_code == 401

    @pytest.mark.parametrize("presented", ["tökén", "ÿþ", "tokén"])
    def test_refuses_a_non_ascii_token_without_crashing(
        self, monkeypatch: pytest.MonkeyPatch, presented: str
    ) -> None:
        """`hmac.compare_digest` raises on a non-ASCII `str`, and this is unauthenticated input.

        An unhandled `UnicodeEncodeError` is a 500 anyone can trigger with no
        credential at all — a crash reachable from outside the boundary the token
        exists to be. Raised by CodeRabbit.

        **Asserted against `_authentic` rather than through the client**, and the
        reason is worth stating: `httpx` refuses to *encode* a non-ASCII header,
        so a request carrying one cannot be sent by a conformant client and the
        obvious test fails in the test client instead of in the code. Headers on
        the wire are bytes, though, and Starlette decodes them as latin-1 — so a
        raw client can hand exactly this string to the function below. Testing
        the endpoint would have proved only that `httpx` is well behaved.
        """
        from watchdog_agent.chat_service import _authentic

        monkeypatch.setenv(TOKEN_VARIABLE, TOKEN)

        assert _authentic(presented) is False

    @pytest.mark.parametrize("configured", ["", "   "])
    def test_fails_closed_when_no_token_is_configured(
        self, monkeypatch: pytest.MonkeyPatch, configured: str
    ) -> None:
        """An absent secret is when the endpoint is most exposed and least watched.

        It is also the state that spends money: an unauthenticated turn is a
        model call anyone can pay for.

        **A valid-looking bearer, not the blank one.** The first version presented
        the blank value itself, which builds the header `"Bearer "` — one part
        after splitting — so `_presented_token` returned `None` and `_authentic`
        refused before the *configured* token mattered. It was 401 whether or not
        the blank-configuration guard existed. Proved by removing the guard and
        watching the old test still pass. Raised by CodeRabbit.
        """
        client = a_client(monkeypatch=monkeypatch, token=configured)

        assert ask(client, bearer="a-plausible-looking-token").status_code == 401

    def test_refuses_the_token_from_the_other_direction(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """AD-17: the two tokens are distinct, and this is what that means.

        One token reused in both directions means either runtime's compromise
        grants the other's identity. Planted, because a shared constant would
        otherwise pass every test above.
        """
        monkeypatch.setenv("AGENT_SERVICE_TOKEN", "the-other-direction")
        client = a_client(monkeypatch=monkeypatch)

        assert ask(client, bearer="the-other-direction").status_code == 401


class TestTheRequestCarriesAQuestionAndNothingElse:
    """AC2, and the clause AD-17 calls load-bearing."""

    @pytest.mark.parametrize(
        "smuggled",
        [
            {"entryId": "dues_status"},
            {"version": 1},
            {"sql": "select 1"},
            {"rows": [{"a": 1}]},
            {"parameters": {"unitNumber": "4B"}},
        ],
    )
    def test_refuses_a_request_that_names_the_query(
        self, monkeypatch: pytest.MonkeyPatch, smuggled: dict
    ) -> None:
        """Refused out loud, never dropped.

        A gateway that could name the entry would be choosing the query itself,
        and story 3.4's argument would be true of a component nobody watches. A
        silently ignored field is indistinguishable from a respected one at the
        call site, so the caller learns nothing and the next caller tries again.
        """
        client = a_client(monkeypatch=monkeypatch)
        body = {"question": "What does 4B owe?", "actorAssertion": ASSERTION, **smuggled}

        response = ask(client, body)

        assert response.status_code == 400
        assert response.json()["code"] == "invalid_request"
        # Names the offending field, so the caller can fix it.
        assert next(iter(smuggled)) in response.json()["message"]

    @pytest.mark.parametrize(
        "unknown",
        [
            {"entry_id": "dues_status"},
            {"catalogEntry": "dues_status"},
            {"catalog_entry_id": "dues_status"},
            {"anythingAtAll": 1},
        ],
    )
    def test_refuses_a_field_it_does_not_recognise(
        self, monkeypatch: pytest.MonkeyPatch, unknown: dict
    ) -> None:
        """An allowlist, because the denylist was bypassable by spelling.

        `FORBIDDEN_FIELDS` named `entryId`, so `entry_id` and `catalogEntry`
        sailed through with a 200 — verified, not reasoned about. This project
        already made this argument once, in `test_no_data_credentials.py`: "the
        allowlist is the real check; the denylist above only makes the message
        better." Raised by CodeRabbit.
        """
        client = a_client(monkeypatch=monkeypatch)
        body = {"question": "What does 4B owe?", "actorAssertion": ASSERTION, **unknown}

        response = ask(client, body)

        assert response.status_code == 400
        assert next(iter(unknown)) in response.json()["message"]

    def test_still_accepts_exactly_the_two_fields_it_declares(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The other direction, so a rule that refuses everything cannot pass.
        assert ask(a_client(monkeypatch=monkeypatch)).status_code == 200

    def test_refuses_an_oversized_body_that_lies_about_its_length(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The branch the header check hides.

        `await request.body()` buffered the whole body *before* the limit was
        measured, so a caller omitting or falsifying `content-length` chose the
        allocation. **This test does not discriminate that fix** — both shapes
        end in a 413, and what changed is how much was read first, which neither
        the client nor the assertion can observe. It is here because the
        streaming branch should be exercised at all; the fix stands on the
        reasoning. Raised by CodeRabbit.
        """
        client = a_client(monkeypatch=monkeypatch)
        huge = b'{"question":"' + b"x" * (128 * 1024) + b'","actorAssertion":"a"}'

        response = client.post(
            CHAT_PATH,
            content=huge,
            headers={"Authorization": f"Bearer {TOKEN}", "content-length": "42"},
        )

        assert response.status_code == 413

    def test_refuses_a_body_larger_than_a_question_could_be(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A question is a sentence. Anything near a megabyte is not one.

        The limit is at the boundary rather than after parsing, so an oversized
        body never reaches `json.loads`. Raised by CodeRabbit.
        """
        client = a_client(monkeypatch=monkeypatch)
        huge = {"question": "x" * (128 * 1024), "actorAssertion": ASSERTION}

        assert ask(client, huge).status_code == 413

    def test_never_routes_a_request_it_refused(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list = []

        def route(question, actor_assertion):
            calls.append(question)
            return ROUTED

        client = a_client(monkeypatch=monkeypatch, route=route)
        ask(client, {"question": "q", "actorAssertion": ASSERTION, "entryId": "dues_status"})

        assert calls == []

    @pytest.mark.parametrize(
        "body",
        [
            {"actorAssertion": ASSERTION},
            {"question": "", "actorAssertion": ASSERTION},
            {"question": "   ", "actorAssertion": ASSERTION},
            {"question": "q"},
            {"question": "q", "actorAssertion": ""},
            {"question": 42, "actorAssertion": ASSERTION},
        ],
    )
    def test_refuses_a_malformed_request(
        self, monkeypatch: pytest.MonkeyPatch, body: dict
    ) -> None:
        assert ask(a_client(monkeypatch=monkeypatch), body).status_code == 400

    def test_refuses_a_body_that_is_not_json(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = a_client(monkeypatch=monkeypatch)

        response = client.post(
            CHAT_PATH, content="not json", headers={"Authorization": f"Bearer {TOKEN}"}
        )

        assert response.status_code == 400

    def test_the_question_reaches_the_router_unchanged(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: dict = {}

        def route(question, actor_assertion):
            seen.update({"question": question, "actor_assertion": actor_assertion})
            return ROUTED

        client = a_client(monkeypatch=monkeypatch, route=route)
        ask(client, {"question": "What does 4B owe for 2026?", "actorAssertion": ASSERTION})

        assert seen == {"question": "What does 4B owe for 2026?", "actor_assertion": ASSERTION}


class TestTheResponse:
    """AC3. All three, or an error — never a partial answer."""

    def test_carries_the_answer_the_provenance_id_and_the_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        body = ask(a_client(monkeypatch=monkeypatch)).json()

        assert body["answer"] == "Unit 4B owes $240.00."
        assert body["provenanceId"] == "prov-1"
        assert body["rows"] == [{"unitNumber": "4B", "balanceOutstanding": "240.00"}]

    def test_carries_the_entry_and_version_the_disclosure_names(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """UX-DR6 labels the disclosure with the catalog entry and version.

        In the *response*, which AD-17 permits — its prohibition is on a
        caller-supplied entry id in the request. The gateway learning which entry
        answered is the opposite of the gateway choosing it.
        """
        body = ask(a_client(monkeypatch=monkeypatch)).json()

        assert body["entryId"] == "dues_status"
        assert body["version"] == 1
        assert body["parameters"] == {"unitNumber": "4B", "assessmentYear": 2026}

    def test_a_narrator_that_returns_nothing_is_an_error_not_a_blank_answer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A blank answer reads as "there is nothing to report".

        Story 3.5 found the same hole in `groundedAnswer` and closed it there;
        this is the wire's half. For a balance, an empty answer is a wrong
        financial answer with a confident face.
        """
        client = a_client(monkeypatch=monkeypatch, narrate=lambda question, routed: "   ")

        assert ask(client).status_code == 500

    def test_the_narrator_sees_the_question_and_the_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        seen: dict = {}

        def narrate(question, routed):
            seen.update({"question": question, "rows": routed.rows})
            return "an answer with 240.00 in it"

        client = a_client(monkeypatch=monkeypatch, narrate=narrate)
        ask(client)

        assert seen["question"] == "What does 4B owe for 2026?"
        assert seen["rows"] == ROUTED.rows


class TestWhenTheTurnCannotBeCompleted:
    """AC5's rule, on this side: a failure is never an empty answer."""

    def test_a_router_failure_is_a_named_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from watchdog_agent.routing import ModelChoseNothing

        def route(question, actor_assertion):
            raise ModelChoseNothing("the model chose no catalog entry")

        response = ask(a_client(monkeypatch=monkeypatch, route=route))

        assert response.status_code == 422
        assert response.json()["code"] == "no_catalog_match"

    def test_an_unknown_entry_is_the_same_honest_refusal(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from watchdog_agent.routing import ModelChoseUnknownEntry

        def route(question, actor_assertion):
            raise ModelChoseUnknownEntry("the model named nothing the catalog holds")

        assert ask(a_client(monkeypatch=monkeypatch, route=route)).status_code == 422

    def test_a_gateway_failure_does_not_leak_its_detail(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The reasoning side is the least trusted consumer in the system.

        A gateway error can carry table names and sometimes row values. The
        message is generic; the detail is logged, exactly as story 3.2's
        endpoint does in the other direction.
        """
        from watchdog_agent.tools_client import GatewayError

        def route(question, actor_assertion):
            raise GatewayError("connection to unit_membership failed", status=500)

        response = ask(a_client(monkeypatch=monkeypatch, route=route))

        assert response.status_code == 502
        assert "unit_membership" not in response.text

    @pytest.mark.parametrize("boom", ["ModelChoseNothing", "GatewayError", "RuntimeError"])
    def test_no_failure_becomes_an_empty_answer(
        self, monkeypatch: pytest.MonkeyPatch, boom: str
    ) -> None:
        """The failure this whole class exists for, swept.

        Parametrized rather than looped: a loop stops at the first failing case,
        so a later regression stays invisible until the earlier one is fixed, and
        the test name does not say which case broke. Raised by CodeRabbit.
        """
        from watchdog_agent.routing import ModelChoseNothing
        from watchdog_agent.tools_client import GatewayError

        raised = {
            "ModelChoseNothing": ModelChoseNothing("x"),
            "GatewayError": GatewayError("y", status=500),
            "RuntimeError": RuntimeError("z"),
        }[boom]

        def route(question, actor_assertion):
            raise raised

        response = ask(a_client(monkeypatch=monkeypatch, route=route))

        assert response.status_code >= 400
        assert "answer" not in response.json()


class TestTheShapeOfTheSurface:
    def test_the_path_is_versioned(self) -> None:
        # AD-17: "versioned `/chat/v*` endpoints only".
        assert CHAT_PATH.startswith("/chat/v")

    def test_only_post_is_accepted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = a_client(monkeypatch=monkeypatch)

        assert client.get(CHAT_PATH, headers={"Authorization": f"Bearer {TOKEN}"}).status_code == 405

    def test_an_unknown_path_is_not_served(self, monkeypatch: pytest.MonkeyPatch) -> None:
        client = a_client(monkeypatch=monkeypatch)

        assert client.post("/chat/v1/anything-else", json={}).status_code == 404
