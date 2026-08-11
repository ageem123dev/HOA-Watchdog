# The agent service

The second runtime. It holds the model key and **no database credential** (AD-3),
and obtains every fact by calling the gateway's `/tools/v1/*` endpoints (AD-15).

## The interpreter is pinned, and the ambient one is wrong

**Do not run `python3 -m venv`.** On the development machine `python3` is
**3.14.6**, and CrewAI's `requires_python` is `<3.14,>=3.10` — so that command
builds an environment CrewAI can never be installed into. Nothing fails at that
moment; it fails much later, in story 3.4, at `pip install crewai`.

```bash
py -3.13 -m venv agent/.venv                              # Windows
python3.13 -m venv agent/.venv                            # Linux/macOS

agent/.venv/Scripts/python.exe -m pip install -e ".[dev]"   # Windows
agent/.venv/bin/python -m pip install -e ".[dev]"           # Linux/macOS
```

Install the **dev extra**, not `pytest` alone: it also declares `tomli` for Python 3.10, which the
test suite needs to read `pyproject.toml` there. Installing only `pytest` makes collection fail on
the oldest interpreter the project claims to support.

`agent/.python-version` records the pin and `agent/pyproject.toml` records the
range; `tests/test_interpreter.py` asserts both against the interpreter actually
running, so a wrong venv fails the suite rather than surviving to 3.4.

## Running the tests

```bash
npm run test:py
```

From the repository root. It runs pytest on the venv above and **refuses if that
venv is missing** rather than falling back to whatever `python` means — a gate
that runs on the wrong runtime reports green from an environment the service
cannot use.

The suite opens no socket and touches no database. The tool client takes its
transport as a parameter; if a test ever wants the network, the design has gone
wrong.

## Configuration

Five variables, and deliberately only five. AD-3 (amended 2026-08-10) allows this
runtime two secrets of its own — `AGENT_SERVICE_TOKEN`, its identity when it
calls Node, and `REASONING_API_KEY` — and AD-17 adds a third it *checks* rather
than presents: `GATEWAY_SERVICE_TOKEN`, the gateway's identity when it calls
here.

| Variable | Why |
| --- | --- |
| `AGENT_SERVICE_TOKEN` | Presented to `/tools/v1/*` as `Authorization: Bearer …`. Must match the gateway's. |
| `GATEWAY_BASE_URL` | Where the gateway is. |
| `REASONING_API_KEY` | The model credential. **Never `GEMINI_API_KEY`** — see below. |
| `REASONING_MODEL` | Optional. Defaults to the spine's binding, `gemini-3.6-flash`. |
| `GATEWAY_SERVICE_TOKEN` | What the **gateway** presents when it calls `/chat/v1/*`. Checked here. |

### Running the service

```bash
npm run agent:serve          # from the repository root
```

That is `uvicorn` on `watchdog_agent.chat_service:create_app`, using the pinned
interpreter from `agent/.venv` for the same reason `npm run test:py` does — a
service started on the ambient 3.14 is one CrewAI cannot be installed into.

`GATEWAY_SERVICE_TOKEN` unset or blank makes `/chat/v1/turn` refuse every caller.
That is deliberate: an absent secret is when the endpoint is most exposed and
least watched, and an unauthenticated turn is a model call anyone can pay for.

### Two tokens, and they are not the same token

`AGENT_SERVICE_TOKEN` is this service's identity when it calls Node.
`GATEWAY_SERVICE_TOKEN` is the gateway's identity when it calls here. AD-17:
"one token reused in both directions means either runtime's compromise grants
the other's identity." A test plants the wrong direction's token and asserts it
is refused, because a shared constant would satisfy every other auth test.

### Never set `GEMINI_API_KEY` here

AD-10 used to be a *vendor* boundary. That clause was withdrawn on 2026-08-10
when reasoning moved to Gemini, so extraction and reasoning are one vendor and
**the separate credential name is the whole of what is left**.

CrewAI picks a key up from the environment when it is not handed one, and
prefers `GOOGLE_API_KEY` over `GEMINI_API_KEY`:

```text
Both GOOGLE_API_KEY and GEMINI_API_KEY are set. Using GOOGLE_API_KEY.
```

So an agent environment carrying either of those silently runs the reasoning
model on the *extraction* credential — and it works, which is what makes it
dangerous. `tests/test_no_data_credentials.py` fails if this service ever reads
them.

**There is no database URL here and there never will be.** That is AD-3, and
`tests/test_no_data_credentials.py` enforces it across three surfaces: the
variables this service names, its committed configuration, and its declared
dependencies. A `psycopg`, `sqlalchemy` or `boto3` dependency fails the suite.

An absent token or gateway URL makes the client refuse **before** it calls
anything, rather than sending a request the gateway will reject — a misdeployed
agent should show up as an error here, not as an unauthenticated caller in the
gateway's log, where it is indistinguishable from someone probing the endpoint.

## Why the suite got slower

`test_model.py` constructs real CrewAI objects, because the property it proves —
that the client does not discover the extraction credential for itself — is a
property of the real class and a fake would prove nothing. That costs ~5.5s to
import `crewai` and ~1.3s per construction.

Measured, not assumed: it is local work and no socket. The file disables CrewAI
telemetry and the OpenTelemetry exporters so the no-network claim is enforced
rather than hoped for. Story 3.3 shipped a test that passed by making a real DNS
lookup and took 11 of that suite's 11.25 seconds while looking healthy, so a
runtime jump gets read here rather than noted.
