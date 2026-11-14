# F01a: canonical assignment lock timing

Related: [feature parity tracking #21](https://github.com/g-offmoore/Artemis-RSVP/issues/21).
This is only the lock-timing slice, not completion of F01 or the reliability roadmap.

## P01a stacked integration

This branch depends on P01a commit `8be1af1` (PR #23), with PR base
`refactor/parity-p01-presentation`, not master. It integrates original F01a
`0d7382d2c8e49886d7a7b150d48678849a0ba7ac` without restoring the deleted bot/API
inline renderers. No P01b personal panel work is included.

`EventPresentationInput.assignmentLockOffsetMinutes` feeds one `buildEventEmbed`
implementation used by the existing exported bot and API adapters. The only
shared output change is an appended `Assignment lock` field; existing field
order/content, buttons, labels, styles, and custom IDs remain intact. The value
explicitly says `Scheduled:` even after an actual lock. Web likewise labels the
policy time `Assignment lock (scheduled)` and retains the separate actual `Locked`
timestamp; this does not redesign lock lifecycle or notifications.

The canonical `computeAssignmentLockScheduledFor` now lives in the small
dependency-free `assignment-lock-time.ts`, re-exported unchanged by identity from
`index.ts`. Its offset predicate is also used by the shared Zod create/PATCH
schema, so presentation and API validation accept the same nonnegative whole
PostgreSQL Int offsets. This avoids a presentation-to-index-to-presentation cycle
and keeps Zod, Node, and Discord runtimes out of the browser presentation subpath.
Tests verify helper identity, schema/predicate agreement including bounds, and
the presentation module's transitive dependency graph.

Integration test-first evidence: after resolving conflicts to P01a adapters,
`npm test -- apps/bot/src/lock-display.test.ts` failed all four policies because
the shared field was missing (RED). After shared implementation, the same tests
passed (GREEN). Tests now import the real exported adapters instead of compiling
deleted inline functions; a runtime URL import of the API adapter keeps bot's
TypeScript rootDir bounded to its own sources. Literal domain/bot/API golden
assertions retain all old fields and append the intended lock field. Web coverage
also distinguishes an actual early lock from the scheduled timestamp.

Integration verification: worktree-local `npm ci` and Prisma generation succeeded
(placeholder local DATABASE_URL, no database connection or migration). Full test
suite passed 258 tests in 21 files with unchanged timeouts. Typecheck initially
identified the cross-app static test import/rootDir issue and an optional fields
access; both were corrected, and full typecheck then passed. Lint, static
`check:deploy`, and the full workspace production build passed. Node v26.4.0 and
npm 11.17.0 were used here; CI's Node 24 was not exercised. Install reported seven
moderate advisories; no dependency upgrade or audit fix was attempted.

Focused Prettier checks passed for the new module, new tests, shared presentation
files, and updated bot/API golden tests. Full-file formatting remains non-green
in eight touched files which also fail against `git show 8be1af1:<path>`:
events.service.ts, message-job-worker.service.ts and its test,
message-jobs.service.ts and its test, web event page, web artemis-api.ts, and
domain index.ts. Unrelated full-file reformatting was deliberately avoided.
Only Next-generated `next-env.d.ts` build churn was restored.

No database/live Discord/browser/deployed-worker smoke test, push, PR creation,
merge, issue closure, or other worker is claimed. Parent verification and
publication remain separate. Original F01a evidence below is historical, not a
claim that those exact original commands/counts were repeated in integration.

## Contract and exact scope

- `computeAssignmentLockScheduledFor(startAt, offsetMinutes)` in `@artemis/domain`
  is the effective-lock-time contract. Offset means elapsed whole minutes before
  the absolute start instant. It does not reinterpret wall-clock time or change
  timezone storage. Existing Discord timestamps and web timezone formatting remain.
- New event creation defaults to 60 minutes, matching rules.md section 11.1.
  Explicit stored values, including legacy 120, remain authoritative. Zero is
  deliberately supported and means lock at event start. Only omission/undefined
  defaults; null, strings, negatives, fractions, NaN, infinity, and values exceeding
  the PostgreSQL signed Int maximum are rejected, not coerced or defaulted.
- Create/PATCH validation shares the offset schema. Old payloads remain valid.
  Omitted PATCH fields do not reset policy. Offset-only edits reschedule pending
  jobs, as do start/end/alert edits. Lock edits affect this occurrence only; the
  existing `applyToFuture` propagation remains limited to non-time metadata.
- Event creation persists the resolved offset explicitly and passes the stored
  policy into scheduling. Time edits pass the existing policy into rescheduling.
  Only PENDING jobs are rescheduled; sent/failed behavior is unchanged.
- Both private organizer warning paths use the same computed lock time. Automatic
  lock audit copy no longer claims T-1h for arbitrary policy. The shared Discord
  embed builder and the web event detail display the computed scheduled lock time.
  Actual `assignmentLockedAt` remains separate and continues to display as Locked.
- No additional presentation extraction, personal panel, lifecycle/notification
  redesign, timezone snapshot, series-policy redesign, or production action.

## Migration and rollout compatibility

`20261114190000_assignment_lock_default` only changes the database column DEFAULT
from 120 to 60. It performs no event UPDATE/backfill, does not change any existing
policy, and leaves earlier migrations untouched. Older binaries can still read
all rows; before mixed-version deployment, note that older scheduling code ignores
non-60 policies. Deploy the API/bot/web versions together before relying on them.

Existing persisted jobs are not automatically reinterpreted by a default-only
migration. Before enabling the new worker, audit upcoming PENDING assignment-lock
jobs against `Event.startAt - assignmentLockOffsetMinutes minutes`. Reconcile any
mismatches via the authenticated event PATCH path, supplying the same currently
stored `assignmentLockOffsetMinutes` (and the authorized actor). This reschedules
pending jobs without resetting legacy policy. Review events whose effective lock
is already past rather than assuming a future schedule. Republish existing posts
where the new visible field is wanted. No reconciliation was run in this session.

The migration was statically checked and the client generated locally; it was not
applied to PostgreSQL. No real database integration, concurrency, deployed worker,
Discord delivery, browser session, or production smoke test is claimed.

## Original F01a test-first evidence

Commands below ran with unchanged default Vitest timeouts:

1. `npm run build --workspace @artemis/domain && npm run build --workspace @artemis/db && npm test -- apps/api/src/events/message-jobs.service.test.ts`
   RED: 3 failed / 3 passed. Custom 30, legacy 120, and zero all incorrectly
   scheduled the hard-coded 17:00 time. After minimal helper/scheduler wiring,
   `npm run build --workspace @artemis/domain && npm test -- apps/api/src/events/message-jobs.service.test.ts`
   GREEN: all 6 passed, including rescheduling after a start-time change.
2. `npm test -- packages/domain/src/lock-policy.test.ts`
   RED: 13 failed (missing defaults/preservation/rejection); GREEN: 13 passed.
3. `npm run build --workspace @artemis/domain && npm test -- apps/api/src/events/lock-policy.test.ts apps/api/src/events/message-job-worker.service.test.ts`
   RED: 9 failed / 2 passed (persistence/scheduler wiring and incorrect private
   warning timestamp/reason); GREEN: 11 passed after wiring the actual call sites.
4. `npm test -- apps/bot/src/lock-display.test.ts 'apps/web/app/events/[id]/lock-display.test.ts'`
   Initial bot/API behavior RED: 4 failed because no lock field existed. Initial
   web import hit Next's preserved-JSX test-loader limitation; the test was changed
   to compile the actual page functions in isolation, without production changes.
   Separate web RED: 4 failed because no scheduled lock display existed.
   Combined GREEN: 8 passed for default/custom/legacy/zero display behavior.

Tests use real domain logic and real service/render functions with mocked
persistence/network/panel boundaries. Bot/API render tests compile their actual
local functions in a test-only VM to avoid starting the bot. The web test compiles
and server-renders the actual page functions with mocked session/API/client
panels. They are not whole-app bot or browser end-to-end tests.

## Original F01a verification observed

- Worktree-local `npm ci` succeeded; no shared/symlinked node_modules. Install
  reported 7 moderate advisories; dependencies were not changed or auto-fixed.
- Local Prisma generation succeeded with a nonsecret, nonproduction placeholder
  DATABASE_URL; no deployment/migration command was run.
- `npm test`: first full run had 210 passing and the known AppModule graph test
  timing out at its unchanged 5000ms default while other gates ran concurrently.
  The isolated AppModule test then passed; a full rerun passed all 211 tests in
  18 files without increasing timeouts or weakening assertions.
- `npm run typecheck`, `npm run lint`, `npm run check:deploy`, and `npm run build`
  passed. check:deploy is static validation, not a deployment smoke test.
- Final targeted run across the six lock-policy/scheduler/worker/display files:
  38 tests passed; the subsequent full run again passed 211 tests in 18 files.
- Prettier formatted the four new test files and the previously formatted API
  post builder; their check passed. The other nine touched TypeScript/TSX files
  already fail full-file formatting at HEAD (verified against `git show HEAD`).
  Full-file formatting remains non-green there; unrelated formatting churn was
  intentionally avoided. Changed code was kept consistent locally.
- Node v26.12.1/npm 11.20.0 were used for gates (initial system Node v26.4.0
  launcher reported `stdin is not a tty`; the installed alternate Node 26 tool
  directory resolved it). CI targets Node 24; that runtime was not exercised.
- Independent review/integration belongs to the parent orchestrator. No child
  worker, push, PR creation, master modification, or issue closure was performed.

## Rollback

1. Roll back consumers first: coordinate worker/API/bot/web rollback; do not let
   old and new schedulers race. Keep P01a and the shared lock helper available until
   consumers no longer depend on them. Do not revert P01a underneath this slice.
2. Revert the integrated F01a code commit if needed, leaving its P01a base intact.
   The additive default change is readable by
   old code, but old code again schedules at 60 regardless of stored policy; audit
   affected pending lock jobs and do not claim custom-policy correctness on it.
3. If the old database default is required, add a new forward migration:
   `ALTER TABLE "Event" ALTER COLUMN "assignmentLockOffsetMinutes" SET DEFAULT 120;`
   Align the Prisma schema with that intentional rollback. Never delete or edit
   an already-applied migration or bulk-reset existing event policies.
4. Reconcile pending jobs through the authorized application path under the chosen
   deployed policy, verify their exact timestamps, and check worker health. Keep
   historical policy, assignment locks, notifications, and audit records intact.
