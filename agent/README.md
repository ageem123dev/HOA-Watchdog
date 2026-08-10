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

agent/.venv/Scripts/python.exe -m pip install pytest      # Windows
agent/.venv/bin/python -m pip install pytest              # Linux/macOS
```

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

Two variables, and deliberately only two:

| Variable | Why |
| --- | --- |
| `AGENT_SERVICE_TOKEN` | Presented to `/tools/v1/*` as `Authorization: Bearer …`. Must match the gateway's. |
| `GATEWAY_BASE_URL` | Where the gateway is. |

**There is no database URL here and there never will be.** That is AD-3, and
`tests/test_no_data_credentials.py` enforces it across three surfaces: the
variables this service names, its committed configuration, and its declared
dependencies. A `psycopg`, `sqlalchemy` or `boto3` dependency fails the suite.

Either variable being absent makes the client refuse **before** it calls
anything, rather than sending a request the gateway will reject — a misdeployed
agent should show up as an error here, not as an unauthenticated caller in the
gateway's log, where it is indistinguishable from someone probing the endpoint.

## What is not here yet

CrewAI, and any model call. Those are story 3.4's. What this story owes them is
an interpreter they can actually use.
