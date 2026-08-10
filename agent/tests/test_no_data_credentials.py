"""AD-3 - the reasoning runtime holds no way to reach data directly.

    "The Node gateway holds every database credential and the object-storage key.
    The Python agent service holds exactly one secret - the model API key - and
    never a database credential, connection string, or storage key. It obtains
    every fact by calling Node's tool endpoints. A code path that gives the agent
    service data access is a violation, not an optimization."

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
import re
import tomllib
from pathlib import Path

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
    "botocore",
    "minio",
    "s3fs",
    "supabase",
)

# Values that look like a way in, whatever the variable is called. Renaming a
# secret does not make it a different secret.
DSN_SHAPED = re.compile(
    r"(?:postgres(?:ql)?|mysql|mongodb|redis|amqp)(?:\+\w+)?://", re.IGNORECASE
)

# Names that carry a credential even when the value is absent from this process -
# their presence in committed config is the violation.
#: `(?<![A-Za-z0-9])` and not `(?:^|_)` for the PG branch. The first version
#: anchored to the start of the *string* or an underscore, so it matched
#: `PG_PASSWORD=x` and `AGENT_PG_PASSWORD=x` but missed `"PG_PASSWORD": "x"` and
#: `export POSTGRES_HOST=...` — the two shapes a credential most often actually
#: appears in. Verified as real misses before the change, not reasoned about.
#: The lookbehind still refuses a mid-word match, so `MYPG_PASSWORD` is not a hit.
FORBIDDEN_NAME = re.compile(
    r"(?:DATABASE_URL|WATCHDOG_(?:WRITER|READER)_DATABASE_URL|"
    r"(?<![A-Za-z0-9])(?:PG|POSTGRES)_(?:PASSWORD|USER|HOST|DSN)|"
    r"R2_(?:ACCOUNT_ID|ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET)|"
    r"AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN))",
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
    """
    interesting = {".toml", ".env", ".ini", ".cfg", ".json", ".yaml", ".yml"}
    found = []
    for path in AGENT_ROOT.rglob("*"):
        if ".venv" in path.parts or "__pycache__" in path.parts:
            continue
        if path.is_file() and (path.suffix in interesting or path.name.startswith(".env")):
            found.append(path)
    return found


def credential_findings(text: str) -> list[str]:
    findings = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if DSN_SHAPED.search(stripped):
            findings.append(f"connection-string shape: {stripped[:60]}")
        elif FORBIDDEN_NAME.search(stripped):
            findings.append(f"credential name: {stripped[:60]}")
    return findings


def test_declares_no_database_or_storage_dependency() -> None:
    """Surface 3, and the one a code scan cannot see."""
    offending = forbidden_dependencies(declared_dependencies())

    assert offending == [], (
        "AD-3: the agent service must not declare a database driver or an "
        f"object-storage client. Found: {offending}"
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
    # Still not a mid-word match.
    assert credential_findings("MYPG_PASSWORD=x") == []

    # And leaves alone what this service is allowed to hold.
    assert credential_findings("AGENT_SERVICE_TOKEN=abc") == []
    assert credential_findings("GATEWAY_BASE_URL=https://gateway.internal") == []
    assert credential_findings("# DATABASE_URL is deliberately absent (AD-3)") == []


#: An environment-variable-shaped name: upper snake case, at least one underscore.
#: `POST`, `Authorization` and `/tools/v1/...` are not; `AGENT_SERVICE_TOKEN` is.
ENV_VAR_SHAPED = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$")



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
        and ENV_VAR_SHAPED.match(node.value)
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

    assert asked == {"AGENT_SERVICE_TOKEN", "GATEWAY_BASE_URL"}, asked


def test_the_environment_reader_detector_works() -> None:
    """Every form, including the indirection the first version could not see."""
    assert environment_variables_read_by('os.environ["DATABASE_URL"]') == {"DATABASE_URL"}
    assert environment_variables_read_by("os.environ.get('R2_BUCKET')") == {"R2_BUCKET"}
    assert environment_variables_read_by('os.getenv("AGENT_SERVICE_TOKEN")') == {
        "AGENT_SERVICE_TOKEN"
    }
    assert environment_variables_read_by("environ.get('PG_PASSWORD')") == {"PG_PASSWORD"}

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
