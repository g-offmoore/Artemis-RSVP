# P03a — bounded natural-language event-window parser

## Scope and API

Parser-only prerequisite for P03; **not natural-language event creation**.
Import `parseNaturalEventWindow` (and the `EventWindowResult` and
`EventWindowErrorCode` types) from `@artemis/domain/event-window-parser`.
The package main export and existing structured date/time API are unchanged.
There are no bot/web changes, database writes, authorization, or publication.

```ts
import { parseNaturalEventWindow } from "@artemis/domain/event-window-parser";

const result = parseNaturalEventWindow({
  text: "fri 6pm",
  timeZone: "America/New_York",
  now: new Date("2026-06-18T16:00:00.000Z"),
});
// { ok: true, window: { startAt: 2026-06-19T22:00:00.000Z,
//   endAt: 2026-06-20T02:00:00.000Z, timeZone: "America/New_York",
//   durationMinutes: 240, durationSource: "default" } }
```

Dates above describe Date objects, not JSON strings. Failures return
`{ ok: false, code }`; no numeric confidence is assigned or implied.
The reference `now` and IANA policy `timeZone` are mandatory. `UTC` is also
accepted; bare abbreviations and numeric offsets are not policy zones.

## Supported grammar and deterministic policy

- English, printable ASCII only, 1–256 raw UTF-16 code units; raw controls,
  tabs, newlines and Unicode are rejected. Leading/trailing spaces, repeated
  ASCII spaces and case are normalized. This is deliberately not a general NLP
  interface or arbitrary event-title extractor.
- Calendar: `today`, `tomorrow`, a full weekday or `sun/mon/tue/wed/thu/fri/sat`,
  optionally prefixed with `next` for weekdays, or `YYYY-MM-DD`, followed by a
  clock. Optional `at` precedes the clock.
- Clock: `1pm`, `6:30 pm`, `12am`, etc. (hours 1–12), or zero-padded 24-hour
  `HH:MM`. A time without a day/date, a day without a time, ambiguous bare
  clocks, slash dates and ISO timestamp strings are unsupported.
- Calendar words use the supplied zone's reference calendar components, not
  the server's local calendar. The adapter passes a UTC wall-clock surrogate
  to pinned chrono-node, then resolves components by exact zone round trips;
  chrono's process-local raw Date is not authoritative.
- Weekdays use chrono-node's forward-date policy. A bare weekday can select
  today if its clock is still ahead, otherwise the upcoming occurrence.
  `next` uses chrono's next-week weekday semantics: from Thursday June 18,
  2026, `next saturday 1pm for 4h` selects **June 27**, not June 20.
  Explicit dates and `today` at/before now reject rather than roll forward.
- Relative: `in N hour(s)` or `in N minute(s)`, where N is a positive decimal
  integer without a leading zero. These are elapsed offsets from the exact
  reference instant, preserving seconds/milliseconds across DST transitions.
  An elapsed offset may land within a repeated local hour because its instant
  is already uniquely specified; ambiguous calendar clocks still reject.
- Optional terminal `for N h`, `for N hours`, `for N m`, `for N minutes`
  (also singular units and compact `4h`/`240m`). Durations are integral elapsed
  minutes, inclusively 30–720. Missing duration uses `defaultDurationMinutes`,
  or 240. The supplied default must be valid even when text overrides it.
  Ends are elapsed durations, not fixed local wall-clock end times.
- Starts must be strictly future and within 366 elapsed days of now, inclusive.
  Reference and proposed window must lie in the bounded UTC domain
  `[2000-01-01, 2100-01-01)`; end must be strictly before the upper bound.
  Calendar resolution enumerates at most 1681 whole-minute offsets within
  ±14 hours, appropriate to the supported modern IANA date domain.

## Rejections and limitations

Codes are deterministic, not a confidence estimate:

| Code                     | Meaning                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `INVALID_REFERENCE_NOW`  | Missing/invalid Date or reference outside the supported domain                                              |
| `INVALID_TIMEZONE`       | Missing, malformed or Intl-unsupported policy zone                                                          |
| `INVALID_TEXT`           | Empty, oversized, non-ASCII or control-containing text                                                      |
| `EMBEDDED_TIMEZONE`      | Recognized embedded abbreviation, IANA name or numeric offset; never an override, even when matching policy |
| `INVALID_DURATION`       | Invalid default, invalid/repeated `for` suffix, or duration outside bounds                                  |
| `UNSUPPORTED_INPUT`      | Unsupported grammar, invalid calendar date, partial parse, multiple candidates or explicit end/range        |
| `NONEXISTENT_LOCAL_TIME` | No instant matches the requested local calendar clock (DST gap/skipped date)                                |
| `AMBIGUOUS_LOCAL_TIME`   | More than one instant matches the calendar clock (DST fold)                                                 |
| `OUT_OF_RANGE`           | Proposal or relative offset exceeds the supported date/lookahead domain                                     |
| `START_NOT_FUTURE`       | Resolved start is at or before now                                                                          |

Validation order is reference, policy zone, raw text, recognized embedded zone,
then duration, grammar/parse, calendar uniqueness and temporal bounds. Inputs
with several problems report the first reached rejection. Unrecognized zone
words are still rejected as unsupported grammar. No embedded zone is accepted.
No explicit fold disambiguation, multiple starts, end-time ranges, recurrence,
fractional/negative offsets, relative days/weeks, locale-dependent dates,
natural-language titles, or Unicode normalization is supported in this slice.
Timezone rules depend on runtime Intl/tzdata; Node 24 CI remains important.

## Structured API compatibility

The legacy `parseEventDateTimeParts` signatures, formats, default zone,
three-attempt conversion and error behavior remain unchanged. Only the Intl
component formatter was extracted to an internal helper. Literal
characterization tests cover midnight, UTC, Kathmandu's fractional-hour offset,
invalid dates, DST gaps and the legacy New York fold choosing the earlier
instant. That legacy fold behavior is not extended to this parser: new calendar
proposals reject folds.

## Verification and provenance

The completion worker inspected every inherited modified/untracked file before
editing. Its first execution of the inherited latest tests passed 113 tests in
the parser/datetime suites, including real subprocesses with `TZ=UTC`,
`America/Los_Angeles`, and `Asia/Tokyo`. This is observed passing regression
coverage, **not evidence of the prior worker's RED/GREEN sequence**. No
behavioral failure was observed in that initial run, and no behavioral repair
or feature expansion was made during completion. Export metadata and formatting
were completed separately from behavioral TDD.

Completion gates: full `npm test` with default test timeouts, `npm run typecheck`,
`npm run lint`, `npm run check:deploy`, `npm run build`, focused Prettier check,
`git diff --check`, and a built-package subpath import smoke assertion.
Observed completion results: 22 test files / 356 tests passed, including 92
parser tests; typecheck, lint, deployment contract checks, production build and
built-package smoke assertions passed on local Node v26.4.0 / npm 11.17.0.
The first full-suite attempt failed on missing generated Prisma client and
unbuilt workspace exports. Running the normal typecheck prerequisite generated
and built these locally; the unchanged full test command then passed. These
setup failures are not behavioral RED evidence. Code generation/build used a
nonsecret localhost placeholder `DATABASE_URL`; no database connection or
migration was requested. Node 24 execution remains a CI verification limitation.
Exact execution results and any limitations are recorded in the completion
manifest outside the repository (`artemis-p03a-result.json`). Production smoke,
Docker deployment and database integration are not claimed by these gates.

## Review repair — strict ISO calendar validation

The reviewer found that `2026-13-05 6pm` with reference
`2026-01-01T00:00:00Z` and policy zone `UTC` was accepted as May 13.
The grammar checked the ISO shape only; pinned chrono-node reinterpreted the
invalid month/day order as `{ year: 2026, month: 5, day: 13 }`. Zone round trips
then validated those reinterpreted components rather than the typed date.

This repair adds direct validation of the typed ISO calendar components after
grammar validation and before chrono: month 1–12, day 1 through the month's
Gregorian length, including the divisible-by-4/100/400 leap-year rule. Invalid
dates return `UNSUPPORTED_INPUT` before calendar resolution or temporal bounds;
`2026-13-01 6pm` therefore cannot become `START_NOT_FUTURE`. Invalid dates are
not normalized or swapped. Supported grammar and existing structured APIs are
unchanged.

Fresh repair TDD evidence (not inherited TDD): the new exact reviewer regression
was run alone before production edits and failed its equality assertion,
receiving `ok: true`, start `2026-05-13T18:00:00.000Z`, rather than
`{ ok: false, code: "UNSUPPORTED_INPUT" }`. After the minimal validator was
added, the identical command passed:
`npm test -- packages/domain/src/event-window-parser.test.ts -t 'rejects an invalid ISO month'`.
Additional regression coverage checks months 00/13/99, zero/overflow days,
30-day month overflow, non-leap February, leap February overflow, century 2100
rejection, valid ISO ordering and month boundaries, and leap years 2028/2000.
These additional checks are regression coverage, not separate observed RED cycles.

Repair gates passed on Node v26.4.0 / npm 11.17.0: focused parser/datetime
130 tests, full unmodified-default-timeout `npm test` 22 files / 373 tests,
`npm run typecheck`, `npm run lint`, `npm run check:deploy`, `npm run build`,
focused Prettier check and `git diff --check`. Built-package subpath assertions
passed for 10 invalid and 7 valid ISO dates, the existing Friday/New York case,
and the legacy structured New York fold. The generated Next root-params import
in `next-env.d.ts` was inspected and only that generated churn was restored.
The pre-existing Vite config-loader warning remains; Node 24, production smoke,
Docker deployment and database integration were not executed. Typecheck/build
used only a nonsecret localhost placeholder `DATABASE_URL` for generation, with
no database operation. No push, PR, merge, deployment, migration, credentials,
configuration or CI changes form part of this bounded repair.

## Dependency, rollback and deferred P03b

`chrono-node` 2.10.3 is a pinned runtime dependency of `@artemis/domain` (MIT,
Node >=16 supported by its engine range, compatible with the project's Node 24
floor). Existing consumers do not import it through the package main. Worktree-
local dependencies are used. Rollback is a revert of this parser/dependency
commit; no persisted data or migration needs reversal.

**P03b remains deferred:** bot/web create paths, exactly-one-input-path UI,
private absolute-local/zone/duration/Discord-timestamp preview, durable expiring
actor-bound preview/confirm state, replay protection, confirm-time
reauthorization/revalidation, idempotent canonical creation/publication, and
wrong-actor/expiry/duplicate-confirm tests. No in-memory-only preview substitute
is included. No public event may be posted by this parser.
