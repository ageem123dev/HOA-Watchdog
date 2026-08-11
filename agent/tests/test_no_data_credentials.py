"""AD-3 - the reasoning runtime holds no way to reach data directly.

    "The Node gateway holds every database credential and the object-storage key.
    The Python agent service holds exactly two secrets - the model API key and
    AD-15's gateway service token - and never a database credential, connection
    string, or storage key. It obtains every fact by calling Node's tool
    endpoints. A code path that gives the agent service data access is a
    violation, not an optimization." (Amended 2026-08-10: the count was wrong,
    the invariant was not - AD-15 added the token after AD-3 was written.)

This is the assertion the whole query path rests on. Stories 3.1 and 3.2 built a
catalog, a provenance log and a token-checked endpoint, and every one of those
guarantees is worth nothing if this runtime can open a connection of its own -
because then there are two paths, and only one of them is audited.

**It checks what the runtime can reach, not what it currently imports.** A grep
for ``psycopg`` over the source is the tempting version and it proves nothing:
AD-3 is about capability. So the three surfaces here are the ones
``core/security/nfr2-guard.test.ts`` chose for NFR-2, for the same reason - an
absent credential is the enforcement, so look where credentials live.

1. what the service asks its environment for;
2. every committed configuration file under ``agent/``;
3. the declared dependencies.

The third is the one a code scan misses entirely. A ``psycopg`` in
``dependencies`` is a database driver installed into the runtime, and the day
somebody needs one number in a hurry it is already there.
"""

from __future__ import annotations

import ast
import os
import re
from pathlib import Path

import sys

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover - the pinned interpreter is 3.13
    import tomli as tomllib

AGENT_ROOT = Path(__file__).resolve().parent.parent

# Driver and client families that would give this runtime direct data access.
# Named as families rather than exact pins: `psycopg`, `psycopg2` and
# `psycopg-binary` are one hazard wearing three names.
FORBIDDEN_DEPENDENCY_PREFIXES = (
    "psycopg",
    "asyncpg",
    "pg8000",
    "sqlalchemy",
    "aiopg",
    "databases",
    "boto3",
    "aioboto3",
    "botocore",
    "minio",
    "s3fs",
    "supabase",
    "pymysql",
    "mysqlclient",
    "pymongo",
    "motor",
    "redis",
    "google-cloud-storage",
    "azure-storage",
)

#: Every dependency the agent service is allowed to declare.
#:
#: **The allowlist is the real check; the denylist above only makes the message
#: better.** A denylist of driver names is a list of the ones somebody thought
#: of — `pymysql`, `pymongo`, `aioboto3` and `google-cloud-storage` were all
#: missing from the first version, and the next gap is whichever client is
#: fashionable next year. AD-3 says what this runtime may hold, so the check that
#: matches AD-3 is "nothing but these", not "none of those". Raised by CodeRabbit
#: on MR !39.
#:
#: `crewai` is here in advance: story 3.4 installs it, and it is the one heavy
#: dependency the architecture has already approved by name.
APPROVED_DEPENDENCIES = frozenset(
    {"crewai", "pytest", "tomli", "httpx", "pydantic", "typing-extensions"}
)

# Values that look like a way in, whatever the variable is called. Renaming a
# secret does not make it a different secret.
DSN_SHAPED = re.compile(
    r"(?:postgres(?:ql)?|mysql|mongodb|redis|amqp)(?:\+\w+)?://", re.IGNORECASE
)

# Names that carry a credential even when the value is absent from this process -
# their presence in committed config is the violation.
#: One negative lookbehind, applied to every branch. It took two review rounds to
#: arrive there, and both mistakes are worth keeping because they were opposite.
#:
#: The first version anchored the PG branch with `(?:^|_)`, which matched
#: `PG_PASSWORD=x` and missed `"PG_PASSWORD": "x"` and `export POSTGRES_HOST=...`
#: - a JSON key and a shell export, the two shapes a credential actually appears
#: in. **Too narrow**, and a guard that misses is the dangerous direction.
#:
#: The second version fixed that branch and left the others bare, so
#: `MYDATABASE_URL` and `XAWS_SECRET_ACCESS_KEY` were reported while
#: `MYPG_PASSWORD` was not - **too wide, inconsistently**, with the regex
#: contradicting its own comment. A guard that cries wolf on one prefix and not
#: another is untrusted in both directions.
#:
#: Both were verified by running the scanner rather than reading it.
FORBIDDEN_NAME = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"WATCHDOG_(?:WRITER|READER)_DATABASE_URL|"
    r"DATABASE_URL|"
    # `PG_PASSWORD` **and** `PGPASSWORD`. The underscore was mandatory, and
    # libpq's real variables have none — `PGPASSWORD`, `PGUSER`, `PGHOST` are
    # what a Postgres client actually reads, so the check was missing the exact
    # names it most needed. Raised by CodeRabbit on MR !39.
    r"(?:PG|POSTGRES)_?(?:PASSWORD|PASSFILE|USER|HOST|PORT|DATABASE|DSN)|"
    r"R2_(?:ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET)|"
    r"AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)|"
    # Azure and Google. The dependency denylist already named their SDKs, and
    # the *name* list did not - so a committed AZURE_STORAGE_CONNECTION_STRING
    # or GOOGLE_APPLICATION_CREDENTIALS walked straight through the surface
    # meant to catch exactly that. Raised by CodeRabbit on MR !39.
    r"AZURE_STORAGE_(?:CONNECTION_STRING|KEY|ACCOUNT_KEY|SAS_TOKEN)|"
    r"GOOGLE_APPLICATION_CREDENTIALS|"
    r"GCP_(?:SERVICE_ACCOUNT|CREDENTIALS)"
    r")",
    re.IGNORECASE,
)


def declared_dependencies() -> list[str]:
    with (AGENT_ROOT / "pyproject.toml").open("rb") as handle:
        project = tomllib.load(handle)["project"]

    declared = list(project.get("dependencies", []))
    for extra in project.get("optional-dependencies", {}).values():
        declared.extend(extra)
    return declared


def forbidden_dependencies(dependencies: list[str]) -> list[str]:
    found = []
    for raw in dependencies:
        # Strip the version specifier: `psycopg[binary]>=3` is `psycopg`.
        name = re.split(r"[<>=!~\[\s;]", raw.strip(), maxsplit=1)[0].lower()
        if name.startswith(FORBIDDEN_DEPENDENCY_PREFIXES):
            found.append(raw)
    return found


def committed_config_files() -> list[Path]:
    """Configuration under `agent/`, excluding the virtual environment.

    `.venv` is a build artefact holding hundreds of installed packages; walking
    it would make this test read the whole of pip's output and find `botocore`
    in some transitive dependency's metadata. Dependencies are checked from the
    declaration instead, which is the thing a reviewer can actually see.

    **The walk prunes rather than filters, and story 3.4 is why.** The first
    version was `AGENT_ROOT.rglob("*")` with a `.venv in path.parts` check on
    each result: correct, and it still enumerated every file in the virtualenv
    before discarding it. Installing CrewAI put roughly thirty thousand files
    there and took this pair of tests from ~0.01s to **3.6s of the suite's 4.0s**
    — the same shape of signal story 3.3 spent two review rounds not reading,
    and a cost that only grows. `os.walk` lets the directories be dropped before
    they are descended into.
    """
    interesting = {".toml", ".env", ".ini", ".cfg", ".json", ".yaml", ".yml"}
    pruned = {".venv", "__pycache__"}
    found = []

    for directory, subdirectories, filenames in os.walk(AGENT_ROOT):
        # In place, because `os.walk` reads this list to decide where to go next.
        # Rebinding the name would prune nothing.
        subdirectories[:] = [name for name in subdirectories if name not in pruned]

        for filename in filenames:
            path = Path(directory) / filename
            if path.suffix in interesting or path.name.startswith(".env"):
                found.append(path)

    return found


def credential_findings(text: str) -> list[str]:
    """The *category* and the line number - never the line.

    The first version put 60 characters of the matching line into the finding,
    and the assertion prints findings on failure. So a test written to prove no
    credential is present would have copied a live DSN, password and all, into
    the terminal and any log capturing it - the one place a secret is most likely
    to be pasted onward. A security test that leaks on failure is worse than no
    test. Raised by CodeRabbit on MR !39.

    The line number is enough to find it, and the file path comes from the
    caller.
    """
    findings = []
    for number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if DSN_SHAPED.search(stripped):
            findings.append(f"line {number}: connection-string shape")
        elif FORBIDDEN_NAME.search(stripped):
            findings.append(f"line {number}: credential name")
    return findings


def test_declares_no_database_or_storage_dependency() -> None:
    """Surface 3, and the one a code scan cannot see."""
    offending = forbidden_dependencies(declared_dependencies())

    assert offending == [], (
        "AD-3: the agent service must not declare a database driver or an "
        f"object-storage client. Found: {offending}"
    )


def test_declares_nothing_outside_the_approved_set() -> None:
    """The allowlist, which is the check that matches AD-3.

    "Not one of these drivers" is a list of the ones somebody thought of. "Nothing
    but these" is the rule the architecture actually states.
    """
    unapproved = sorted(
        name
        for name in (
            re.split(r"[<>=!~\[\s;]", raw.strip(), maxsplit=1)[0].lower()
            for raw in declared_dependencies()
        )
        if name and name not in APPROVED_DEPENDENCIES
    )

    assert unapproved == [], (
        "AD-3: the agent service declares dependencies nobody approved: "
        f"{unapproved}. Add it to APPROVED_DEPENDENCIES with a reason, or remove it."
    )


def test_the_dependency_check_sees_a_planted_violation() -> None:
    """The detector, against what it exists to catch.

    Without this, the assertion above passes because `dependencies` is empty -
    it would pass just as happily with the check deleted. Story 3.2 shipped two
    guards of exactly that shape and both were caught by review, not by the suite.
    """
    assert forbidden_dependencies(["psycopg[binary]>=3.1"]) == ["psycopg[binary]>=3.1"]
    assert forbidden_dependencies(["SQLAlchemy==2.0.0"]) == ["SQLAlchemy==2.0.0"]
    assert forbidden_dependencies(["boto3"]) == ["boto3"]
    # And does not fire on what the service legitimately needs.
    assert forbidden_dependencies(["httpx>=0.27", "pytest>=8", "crewai==1.15.8"]) == []
    # The families the first version missed entirely.
    assert forbidden_dependencies(["pymongo"]) == ["pymongo"]
    assert forbidden_dependencies(["PyMySQL==1.1.0"]) == ["PyMySQL==1.1.0"]
    assert forbidden_dependencies(["aioboto3"]) == ["aioboto3"]
    assert forbidden_dependencies(["google-cloud-storage"]) == ["google-cloud-storage"]


def test_committed_configuration_holds_no_credential() -> None:
    """Surfaces 2. Every committed config file under `agent/`."""
    offending: dict[str, list[str]] = {}
    for path in committed_config_files():
        findings = credential_findings(path.read_text(encoding="utf-8", errors="replace"))
        if findings:
            offending[str(path.relative_to(AGENT_ROOT))] = findings

    assert offending == {}, f"AD-3: credentials in agent configuration: {offending}"


def test_the_configuration_scan_finds_files_to_read() -> None:
    """An empty sweep passes the assertion above without checking anything."""
    names = {path.name for path in committed_config_files()}

    assert "pyproject.toml" in names, f"scanned only {names}"


def test_the_credential_detector_sees_planted_violations() -> None:
    """Both shapes: a value that is a DSN, and a name that carries one."""
    assert credential_findings("DATABASE_URL=postgres://u:p@host:5432/db")
    assert credential_findings("some_other_name = postgresql+psycopg://u:p@h/db")
    assert credential_findings("R2_SECRET_ACCESS_KEY=abc123")
    assert credential_findings("WATCHDOG_READER_DATABASE_URL=")

    # The two shapes a credential actually appears in, and the two the first
    # version of this regex missed — a JSON key and a shell export. Raised by
    # Argus, and confirmed as real misses before the fix.
    assert credential_findings('"PG_PASSWORD": "secret"')
    assert credential_findings("export POSTGRES_HOST=db.internal")
    assert credential_findings("  PG_DSN = postgres://u:p@h/db")
    # Still not a mid-word match - and now on every branch, not just the PG one.
    assert credential_findings("MYPG_PASSWORD=x") == []
    assert credential_findings("MYDATABASE_URL=x") == []
    assert credential_findings("XAWS_SECRET_ACCESS_KEY=y") == []
    # An underscore before it is still a hit: AGENT_DATABASE_URL is a database URL.
    assert credential_findings("AGENT_DATABASE_URL=x")
    # libpq's real variables, which have no underscore and were all missed.
    assert credential_findings("PGPASSWORD=secret")
    assert credential_findings("PGUSER=watchdog")
    assert credential_findings("PGHOST=db.internal")
    # Azure and Google, beside the AWS and R2 cases above.
    assert credential_findings("AZURE_STORAGE_CONNECTION_STRING=DefaultEndpoints...")
    assert credential_findings("GOOGLE_APPLICATION_CREDENTIALS=/etc/gcp.json")
    assert credential_findings("AZURE_STORAGE_ACCOUNT_KEY=abc")

    # And leaves alone what this service is allowed to hold.
    assert credential_findings("AGENT_SERVICE_TOKEN=abc") == []
    assert credential_findings("GATEWAY_BASE_URL=https://gateway.internal") == []
    assert credential_findings("# DATABASE_URL is deliberately absent (AD-3)") == []


#: An environment-variable-shaped name: upper snake case, at least one underscore.
#: `POST`, `Authorization` and `/tools/v1/...` are not; `AGENT_SERVICE_TOKEN` is.
ENV_VAR_SHAPED = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$")


def looks_like_an_environment_variable(value: str) -> bool:
    """Upper snake case - **or** a credential name with no underscore at all.

    The underscore requirement keeps `POST`, `Authorization` and `Content-Type`
    out of the results, and it is worth keeping. It also made MR !39's fix
    unreachable: libpq's variables are `PGPASSWORD`, `PGUSER`, `PGHOST`, with no
    underscore anywhere, and `FORBIDDEN_NAME` was widened precisely to catch
    them. This filter ran first and dropped them before that check ever saw one,
    so the guard was blind to exactly the names it had been fixed to catch.
    Verified by running the detector rather than by reading it. Raised by Argus.

    The second branch widens by exactly the forbidden set rather than in general,
    so `POST` is still not a variable and `PGPASSWORD` now is.
    """
    if ENV_VAR_SHAPED.match(value):
        return True

    return value.isupper() and bool(FORBIDDEN_NAME.search(value))



def environment_variables_read_by(source: str) -> set[str]:
    """Every environment-variable name the service names, in any form.

    **Not a call-site matcher, and that is the point.** The first version matched
    `os.environ["X"]`, `os.environ.get("X")` and `os.getenv("X")` - and found
    *nothing*, because `tools_client.py` reads through a module constant:

        TOKEN_VARIABLE = "AGENT_SERVICE_TOKEN"
        ...
        os.environ.get(variable)

    So the guard passed by seeing no variables at all, which is the vacuous shape
    this file is otherwise full of warnings about. It was caught by the
    exhaustive assertion below - "reads exactly these two" - and not by the
    absence one, which is the argument for writing both.

    Matching every upper-snake string constant is coarser and strictly safer: it
    cannot miss the indirection, and a false positive is a name somebody has to
    justify rather than a hole nobody sees.

    Parsed with `ast` rather than scanned with a regex. A regex reads comments
    too, so `# never read DATABASE_URL here` would be reported as a violation -
    a false positive on a guard whose whole value is being trusted. `ast` sees
    only real string constants. Raised by CodeRabbit on the local round; `ast`
    is in the standard library, so this costs no dependency.
    """
    return {
        node.value
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and looks_like_an_environment_variable(node.value)
    }


def service_source_files() -> list[Path]:
    package = AGENT_ROOT / "watchdog_agent"
    return [p for p in package.rglob("*.py") if "__pycache__" not in p.parts]


def test_the_service_reads_no_data_credential_from_its_environment() -> None:
    """Surface 1, scoped to something that is actually true.

    An earlier draft asserted that `os.environ` held no `DATABASE_URL`. That is
    the wrong assertion on this machine and would have been a false comfort: the
    Node gateway legitimately holds every database credential, and on a developer
    shell both runtimes share one environment. A test that passes because nobody
    exported a variable today proves nothing about the service.

    What is checkable is **what this service asks for**. A runtime that never
    looks up a connection string cannot use one, whatever happens to be exported
    around it - and asking for one is a visible, reviewable act.

    The deployed service's environment is the surface neither this nor any local
    test can see; that belongs to the deployment, and AD-3's credential
    distribution is what governs it.
    """
    asked_for: dict[str, list[str]] = {}
    for path in service_source_files():
        names = environment_variables_read_by(path.read_text(encoding="utf-8"))
        offending = sorted(n for n in names if FORBIDDEN_NAME.search(n))
        if offending:
            asked_for[str(path.relative_to(AGENT_ROOT))] = offending

    assert asked_for == {}, f"AD-3: the service reads data credentials: {asked_for}"


def test_the_source_sweep_finds_files_to_read() -> None:
    """The sweep above passes over an empty package without checking anything.

    It genuinely was empty until the client landed - the assertion existed and
    proved nothing for one task. Pinned so a package that stops being scanned
    fails here rather than going quiet.
    """
    scanned = {path.name for path in service_source_files()}

    assert "tools_client.py" in scanned, f"scanned only {scanned}"


def test_the_service_asks_only_for_what_ad3_allows() -> None:
    """The positive half: it reads the token and the gateway address, and no more.

    An exhaustive assertion rather than an absence one. "No forbidden variable"
    stays true if the service starts reading something nobody classified; this
    fails on any new variable at all, which makes adding one a decision somebody
    makes rather than a line that slips through.
    """
    asked: set[str] = set()
    for path in service_source_files():
        asked |= environment_variables_read_by(path.read_text(encoding="utf-8"))

    assert asked == {
        "AGENT_SERVICE_TOKEN",
        "GATEWAY_BASE_URL",
        # Story 3.4. AD-3 was amended on 2026-08-10 from "exactly one secret" to
        # "exactly two secrets - the model API key and AD-15's gateway service
        # token", and this is the line where that amendment stopped being
        # editorial. The guard did what it was written to do: adding a variable
        # was a decision somebody had to make in a diff.
        "REASONING_API_KEY",
        # Not a credential. Which model, by variable, per AD-11's "the specific
        # model id is seed, not invariant".
        "REASONING_MODEL",
    }, asked


def test_the_service_never_reads_the_extraction_credential() -> None:
    """AD-10, which is now a credential boundary and nothing else.

    The vendor clause was withdrawn on 2026-08-10 when reasoning moved to
    Gemini, so extraction and reasoning are one vendor and the *names* are the
    whole separation. `GEMINI_API_KEY` belongs to the `web` deploy unit.

    This is a separate assertion from the exhaustive one above because it says a
    different thing. That one fails on any new variable and points at AD-3; this
    names these two and points at AD-10, so whoever hits it reads the reason
    rather than working it out. CrewAI prefers `GOOGLE_API_KEY` over
    `GEMINI_API_KEY` when it discovers a key for itself, which is why both are
    named.
    """
    forbidden = {"GEMINI_API_KEY", "GOOGLE_API_KEY"}
    reading: dict[str, list[str]] = {}

    for path in service_source_files():
        names = environment_variables_read_by(path.read_text(encoding="utf-8"))
        shared = sorted(names & forbidden)
        if shared:
            reading[str(path.relative_to(AGENT_ROOT))] = shared

    assert reading == {}, (
        "AD-10: the reasoning runtime read the extraction credential. Credential separation is "
        f"the whole of that boundary since the vendor clause was withdrawn. {reading}"
    )


def test_the_environment_reader_detector_works() -> None:
    """Every form, including the indirection the first version could not see."""
    assert environment_variables_read_by('os.environ["DATABASE_URL"]') == {"DATABASE_URL"}
    assert environment_variables_read_by("os.environ.get('R2_BUCKET')") == {"R2_BUCKET"}
    assert environment_variables_read_by('os.getenv("AGENT_SERVICE_TOKEN")') == {
        "AGENT_SERVICE_TOKEN"
    }
    assert environment_variables_read_by("environ.get('PG_PASSWORD')") == {"PG_PASSWORD"}

    # No underscore anywhere, which is how libpq actually spells them. The shape
    # filter required one and dropped these before `FORBIDDEN_NAME` could see
    # them, making MR !39's fix unreachable. Raised by Argus on story 3.4.
    assert environment_variables_read_by('os.environ["PGPASSWORD"]') == {"PGPASSWORD"}
    assert environment_variables_read_by("os.getenv('PGUSER')") == {"PGUSER"}
    assert environment_variables_read_by('os.environ.get("PGHOST")') == {"PGHOST"}

    # The form that actually ships: a module constant read indirectly. A
    # call-site matcher returns nothing here, and returning nothing is how the
    # guard passed while checking nothing.
    assert environment_variables_read_by(
        'NAME = "WATCHDOG_READER_DATABASE_URL"\n...\nos.environ.get(NAME)'
    ) == {"WATCHDOG_READER_DATABASE_URL"}

    # And it does not fire on ordinary strings that merely happen to be quoted.
    assert environment_variables_read_by('method = "POST"') == set()
    assert environment_variables_read_by('path = "/tools/v1/catalog/execute"') == set()
    assert environment_variables_read_by('header = "Content-Type"') == set()

    # What `ast` buys over a regex: a comment is not code. A scanner that read
    # this line would report a violation for a line that runs nothing, on a
    # guard whose entire value is being trusted. Raised by CodeRabbit.
    assert environment_variables_read_by("# never read DATABASE_URL here") == set()
    assert environment_variables_read_by('x = 1  # DATABASE_URL is absent (AD-3)') == set()

    # And the classification on top of it.
    assert FORBIDDEN_NAME.search("DATABASE_URL")
    assert FORBIDDEN_NAME.search("R2_BUCKET")
    assert not FORBIDDEN_NAME.search("AGENT_SERVICE_TOKEN")
    assert not FORBIDDEN_NAME.search("GATEWAY_BASE_URL")
