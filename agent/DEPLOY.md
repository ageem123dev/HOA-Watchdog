# Deploying the agent service

**Its own Railway service, and that is not a preference.** `deploy-units.json` declares `web` and
`agent` as separate units, and `core/security/dual-llm-boundary.ts` check C3 fails any unit carrying
both the `extraction` and `reasoning` responsibilities. Co-locating them means editing tracked config
to merge the units, which turns the suite red — deliberately.

The practical reason is the same rule from the other side: Railway environment variables are
per-service, so sharing a service would hand this runtime `WATCHDOG_WRITER_DATABASE_URL`, `R2_*` and
`GEMINI_API_KEY`. AD-3 says it holds a model key and the two service tokens and never a data
credential; `tests/test_no_data_credentials.py` exists to keep that true.

## Settings

| | |
| --- | --- |
| Build context | this directory (`agent/`), not the repository root |
| Python | 3.13, from `.python-version`. CrewAI pins `>=3.10,<3.14` |
| Install | `pip install .` — `pyproject.toml` is the only dependency list |
| Start | see `railway.json` |

**`--host ::`, not `0.0.0.0`.** Railway's private network is IPv6-only, so a service bound to
`0.0.0.0` is unreachable at `agent.railway.internal`. Binding `::` is dual-stack on Linux and serves
both the public proxy and the private network, so it does not have to change when this moves private.

**`python -m uvicorn`, not `uvicorn`.** The console script is not on `PATH` in Railpack's runtime
image — the first deploy restart-looped on `uvicorn: command not found`. Going through the
interpreter works wherever the package is importable, which is why `scripts/run-agent.mjs` invokes it
the same way locally.

**Config as code.** This file is only read if the service's *config-as-code file path* is set to
`agent/railway.json`. Railway looks for `railway.json` at the **repository** root by default, so a
root directory of `agent` does not make it findable — the two settings are independent. Leaving the
start command in the dashboard instead works, but it does not travel to a second environment.

**No health check path.** The service exposes exactly one route, `POST /chat/v1/turn`. A GET health
check against it would return 405 and Railway would report the deploy unhealthy. Adding a health
endpoint is a code change with a test, not something to smuggle into a deploy.

## Variables

Set on the **agent** service:

| Variable | Value |
| --- | --- |
| `REASONING_API_KEY` | the reasoning model credential — never the extraction key (AD-10) |
| `REASONING_MODEL` | optional; defaults to the spine's binding |
| `AGENT_SERVICE_TOKEN` | `${{<web-service>.AGENT_SERVICE_TOKEN}}` |
| `GATEWAY_SERVICE_TOKEN` | `${{<web-service>.GATEWAY_SERVICE_TOKEN}}` |

Reference the web service's values rather than copying them: the two runtimes must agree, and a
pasted copy is a second source that drifts. **Two different tokens, deliberately** (AD-17) — one is
the agent's identity calling Node, the other is Node's identity calling the agent.

Then set `AGENT_BASE_URL` on the **web** service to this service's address.

## Known gap while this is public

AD-15 puts `/tools/*` and `/chat/*` on the private network and off any public domain. While the
agent has a public domain, that mechanism is unimplemented and the service token is the whole
boundary — the state the spine already records as the open item. Moving to private later is a
domain change and an `AGENT_BASE_URL` update; the `--host ::` binding is already right for it.
