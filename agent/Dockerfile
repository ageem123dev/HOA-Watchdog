# The agent service image.
#
# A Dockerfile rather than the auto-detected builder, and that is a decision made
# after four failed deploys rather than a preference.
#
# Railpack detects Python here but installs nothing: it recognises
# `requirements.txt` and the poetry/pdm/uv lockfiles, and a plain PEP 621
# `pyproject.toml` gets the interpreter alone. Supplying an explicit build
# command does install the dependencies -- the log says "Successfully installed
# ... uvicorn" -- and they still are not there at runtime, because its build and
# runtime are separate layers and neither `/mise/installs` (where a root `pip
# install` lands) nor a virtualenv written into `/app` is carried across. Each
# attempt failed the same way from the outside: a green build, then a container
# looping on `No module named uvicorn`, which reads like a build failure and is
# not one.
#
# One image, one interpreter, one `site-packages`. Nothing to reason about.
#
# The alternative was a `requirements.txt`, which railpack would have handled
# natively. It is deliberately not used: it would be a second dependency list,
# and `tests/test_no_data_credentials.py` reads only `pyproject.toml` -- so a
# database driver added to the wrong file would bypass the AD-3 allowlist that
# exists to keep a data credential out of this runtime.

# 3.13 matches `.python-version` and satisfies the `>=3.10,<3.14` that AD-15
# quotes from CrewAI's own `requires_python`. The upper bound is the load-bearing
# half: the ambient interpreter on the development machine is 3.14, which CrewAI
# cannot be installed into.
FROM python:3.13-slim

WORKDIR /app

# `pip install .` installs the package as well as its dependencies, so it has to
# come after the source -- which means **a change under `watchdog_agent/`
# reinstalls everything**, roughly two minutes. Only a change to the `CMD` or
# below is cheap.
#
# Splitting that (install dependencies from `pyproject.toml`, copy source, then
# `--no-deps .`) would cache the expensive half across code changes. Not done
# yet: it needs the dependency list extracted at build time to avoid a second
# committed list, and the trade is real build-time complexity against a rebuild
# nobody waits on very often.
COPY pyproject.toml ./
COPY watchdog_agent ./watchdog_agent
RUN python -m pip install --no-cache-dir --upgrade pip \
 && python -m pip install --no-cache-dir .

# Unbuffered, or the first crash is invisible: Python holds stdout in a pipe and
# a container that dies takes the explanation with it.
ENV PYTHONUNBUFFERED=1

# `--factory`, because `create_app` takes its router and narrator as parameters
# so the suite can substitute them; a module-level instance would resolve them at
# import time, which is what makes a service untestable.
#
# **`--host 0.0.0.0`, and this was measured rather than assumed.** `::` is the
# binding Railway's docs give for its IPv6-only private network, and the
# expectation was that dual-stack would serve the public proxy too. It does not:
# the container came up clean on `http://[::]:8080` and the edge returned 502 to
# every request. The public proxy reaches the container over IPv4.
#
# So this is right for the public domain the service has today, and is the line
# to revisit when AD-15's private networking lands -- `::` then, or both.
#
# Shell form for `$PORT`, which Railway injects. The fallback matches the local
# default in `scripts/run-agent.mjs`.
CMD ["sh", "-c", "python -m uvicorn watchdog_agent.chat_service:create_app --factory --host 0.0.0.0 --port ${PORT:-8787}"]
