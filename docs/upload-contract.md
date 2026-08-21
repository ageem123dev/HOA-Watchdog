# What you can upload

Everything here is enforced by code. Each value names the constant that holds it, so if this page and
the application ever disagree, `docs/upload-contract.test.ts` fails and names the value — the page
cannot quietly go stale. It has before: the README described a Supabase project four weeks after
Supabase was removed, and nothing failed.

## The short version

Upload a **CSV** or **Excel** file and it is read immediately, at upload time. Upload a **PDF**,
**PNG** or **JPG** and it is stored now and read a few seconds later by a model.

If this is a fresh install, **upload the assessment roll first**. Nothing else in the system creates
units, and a deposit that names a unit nobody has recorded is held rather than guessed at — so a
deposit uploaded into an empty system is filed correctly and looks broken. See
[Order matters on a fresh install](#order-matters-on-a-fresh-install).

## Formats

Six content types are accepted (`ACCEPTED_CONTENT_TYPES` in `core/ingestion/acceptance.ts`). The file
is checked against its **signature bytes**, not its extension or the type your browser claims — a
`.pdf` that is really a ZIP is refused.

| Format | Content type | Read how |
| --- | --- | --- |
| PDF | `application/pdf` | Model, after upload |
| PNG | `image/png` | Model, after upload |
| JPG | `image/jpeg` | Model, after upload |
| CSV | `text/csv` | Parsed at upload time |
| Excel (.xls) | `application/vnd.ms-excel` | Parsed at upload time |
| Excel (.xlsx) | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | Parsed at upload time |

**The split is the most important thing on this page.** Spreadsheets never reach a model: they are
parsed in the application, deterministically, and cost nothing per document. Scans and photographs
are sent to a model, which costs money per document and can be wrong in ways a parser cannot.

## Limits

| Limit | Value | Constant |
| --- | --- | --- |
| One file | 25 MiB | `MAX_DOCUMENT_BYTES` |
| One upload, all files together | 50 MiB | `MAX_UPLOAD_BATCH_BYTES` |
| Files per upload | 20 | `MAX_FILES_PER_UPLOAD` |
| Cells in a workbook | 500,000 | `MAX_WORKBOOK_CELLS` |

A file that breaks one of these is refused **on its own**. The other nineteen in the batch are still
read.

## Why a file is refused

Four reasons (`REJECTION_REASONS`). These are about the *file*, and none of them reach the ledger.

| Reason | What happened | What to do |
| --- | --- | --- |
| `unsupported-type` | Not one of the six formats, or the signature bytes disagree with the type | Export it again as CSV or PDF |
| `too-large` | Over 25 MiB | Split it |
| `empty` | Zero bytes | Check the export finished |
| `unreadable` | The container is damaged, or a workbook exceeds the cell ceiling | Re-export from the original |

`unreadable` here means **the container lied or is broken**. It is not the same word the table reader
uses below, which is about columns.

## Spreadsheets: the column contract

The first row is a header row. Headers are matched case-insensitively after trimming, so `Date`,
`date` and ` DATE ` are one column.

**Cell values are trimmed too.** Leading and trailing spaces never reach the ledger, so ` 4B ` and
`4B` are stored identically, and a cell holding only spaces counts as empty.

### Required columns

`REQUIRED_HEADERS` — a file without all three is refused before any row is read.

| Column | Meaning |
| --- | --- |
| `date` | `YYYY-MM-DD` |
| `description` | The vendor, the payer, or the holder — see kinds below |
| `amount` | Decimal, matching `^-?\d{1,12}(\.\d{1,2})?$` |

Amounts are exact decimals end to end and are never floats. A negative amount is a credit.

### Optional columns

`OPTIONAL_HEADERS` — absent is fine, and blank means absent.

| Column | Used by | Meaning |
| --- | --- | --- |
| `reference` | Any kind | The transaction reference. Not the unit |
| `unit` | `deposit`, `assessment_roll` | The unit this row is about |
| `cycle` | `assessment_roll` | One of the [billing cycles](#billing-cycles) |
| `year` | `assessment_roll` | The assessment year, at most 2200 |

`unit` and `reference` are deliberately separate columns. A deposit line commonly carries both — the
unit it settles and the bank's own reference — and one column with two meanings depending on a
sibling cell is a rule nobody can read off the header row.

`cycle` and `year` are the roll's own two columns (`ROLL_HEADERS`). They are required only of a file
that actually contains roll rows, so an invoice export is never asked for them.

### Document kinds

**Declared when you upload, from `DOCUMENT_KINDS`. One file is one kind.**

It was a `type` column until this release, read row by row, and a file could mix kinds. It cannot
now: you say what a document is when you send it, and every row in it is that. A file that still
carries a `type` column is refused rather than having the column ignored — an ignored column is a
file that looks like it said something it did not.

There is no default. A submission that declares nothing is refused, because a default would put the
decision back in the file by omission.

| Kind | `description` holds | Extra columns | What it does |
| --- | --- | --- | --- |
| `statement` | The counterparty | — | Stores figures. The plainest kind, and nothing more |
| `invoice` | The vendor | — | Stores figures. An unknown vendor is held for a human |
| `deposit` | The payer | `unit` | Becomes payments against units |
| `assessment_roll` | The unit holder | `unit`, `cycle`, `year` | **Creates units, holders, tenures and assessments** |
| `other` | Anything | — | Stores figures and nothing more |

### Text limits on a row

A row breaking one of these is invalid, and one invalid row refuses the whole file.

| Field | Limit |
| --- | --- |
| `description` | 200 characters |
| `reference` | 64 characters |
| `unit` | 64 characters |

Counted in code points, so accented and non-Latin characters count as one each.

## Why a table cannot be read

Eight reasons (`TABULAR_PROBLEMS`). These are about the *declaration, columns and rows*, after the
file itself was accepted.

| Reason | What happened |
| --- | --- |
| `unreadable-file` | The bytes are not a table this reader can open |
| `missing-headers` | A required column is absent — the message names which |
| `duplicate-headers` | The same column appears twice, so a cell is ambiguous |
| `no-rows` | Headers and nothing under them |
| `invalid-row` | A row broke a rule above — the message names the row number |
| `duplicate-unit` | Two roll rows claim the same unit for the same year |
| `unknown-kind` | The upload declared no document kind, or one this contract does not publish |
| `kind-is-not-a-column` | The file carries a `type` column, which is no longer how a kind is stated |

**One bad row refuses the whole document.** That is deliberate: storing the other 199 rows is how a
ledger comes to be missing one line without saying so. Nothing is stored, so a corrected export can
simply be uploaded again.

## Deposits: what happens to each line

A deposit line either becomes a payment against a unit, or is **held** for a human. Nothing is ever
attributed to a unit on a guess — a held line costs a treasurer a question, and a misattributed one
costs somebody their standing with the board.

Five reasons a line is held (`HOLD_REASONS`):

| Reason | What happened |
| --- | --- |
| `unknown-unit` | The `unit` value matches no unit on record |
| `missing-reference` | The `unit` cell was empty |
| `missing-amount` | The `amount` cell was empty |
| `missing-date` | The `date` cell was empty |
| `unsupported-amount` | Zero, negative, or more precision than the ledger stores |

A unit is matched leniently: case and surrounding spaces are ignored, so `4b ` finds `4B`. Leading
zeroes are **not** ignored — `07` and `7` are different units, because zero-padding is a real
convention and deciding it means nothing is a decision about somebody's data.

A deposit whose every line is held is still a document that was read successfully.

## Order matters on a fresh install

Units are created by **uploading an assessment roll** and by nothing else. There is no units screen.

So on a new installation:

1. Upload the **assessment roll** first. It creates the units, the holders, their tenures, and what
   each unit owes for the year.
2. Then upload **deposits**. Each line now finds the unit it names.

Upload them the other way round and every deposit line is held with `unknown-unit`. That is the
system working correctly — it will not invent a unit to make a payment fit — but on a fresh install
it looks like a failure, so the order is worth following.

## Billing cycles

`BILLING_CYCLES` — the `cycle` column on a roll row.

| Cycle | Instalments | Due |
| --- | --- | --- |
| `monthly` | Twelve | The start of each month |
| `six_monthly` | Two | The starts of January and July |
| `annual` | One | The start of the year |

Instalments fall due at the **start** of the period, and any remainder from dividing the annual
amount lands on the earliest instalments.
