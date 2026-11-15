# P01b - Simplified public post and personal signup panel

Tracking: issue #21 (rollout), stacked on P01a (PR #23, base commit `8be1af1`).
This PR is stacked: its base is `refactor/parity-p01-presentation`, not `master`.

P01 is NOT fully complete after this slice; see "Deferred".

## Scope

1. Public post controls are now literally **Join**, **Run a table**,
   **My signup** (`join:` / `run_table:` / `my_signup:` custom IDs), built once
   in `packages/domain/src/event-presentation.ts` and adapted by the bot and
   the API publisher.
   - CANCELLED / COMPLETED / ARCHIVED / DRAFT: no controls.
   - LOCKED / SIGNUP_CLOSED / IN_PROGRESS / `assignmentLockedAt` set: only
     My signup.
   - No organizer actions or diagnostics are exposed.
2. `GET /api/v1/events/:id/my-signup` - a participant-safe view for the
   acting participant (see trust model).
3. State-aware **ephemeral** panel (bot): no registration, player,
   player + backup, active GM, tentative vs confirmed seat, waitlist, locked,
   cancelled, completed.
   - Join opens a short ephemeral choice (legacy Normal/Heroic, or one generic
     "Join"). Guests, preferences and backup availability are managed
     afterward from My signup; nothing forces a large modal before signup.
   - Mutations reuse the existing API endpoints: `POST /rsvps` (join and
     backup availability, which re-validate eligibility, window, role
     exclusivity), `DELETE /rsvps/:user` (cancel), existing guest/preferences
     flows (`guest:` / `prefs:`), existing host modal (`host:`) for tables.
   - Cancel is two-step and states that guests are removed with the owner.
   - Backup availability is an explicit button, shown only when a live
     eligibility check passes (fails closed), and re-sends the player's own
     category so it is not reset.
   - Run a table: unregistered users get a button into the existing validated
     host form; a registered player is told to cancel their player signup first
     (explicit change-role, guests handled) - it never silently converts a
     player into a DM. An active GM is sent to Edit table.
   - Seat wording never overpromises: projected rows and "confirmed" rows on an
     event without `assignmentLockedAt` are shown as tentative and never name a
     table; a table/GM is shown only for a CONFIRMED seat on a locked event.
     Waitlist copy says there is no confirmed seat.
   - No reminder preferences are shown (P02 does not exist).
4. Legacy custom IDs keep routing (`rsvp:`, `guest:`, `guest_text:`, `host:`,
   `dm:`, `prefs:`, `cancel_rsvp:`, `backup_dm:`, `assignment:`, and the
   backup-DM DM buttons). Exception by design: legacy `assignment:` now opens
   the safe My signup panel; the old handler named a table for unreleased
   (projected) assignments from the full event payload.
5. User-facing errors are ephemeral. Every new handler defers (ephemeral) or
   defers-update before any network call, except the wrong-actor refusal which
   makes no network call. Unknown/stale IDs get an ephemeral explanation.
6. The public post is refreshed through the canonical message (event
   `channelId`/`messageId`, else the public message id carried in panel IDs,
   else the clicked message only if it is not ephemeral). The ephemeral panel
   is never edited with the public embed. (The previous `refreshEventMessage`
   edited `interaction.message`, which is the private panel when the click came
   from an ephemeral message.)

## Security / trust boundaries

- The route is NOT `@Public`. It sits behind the global `ApiTokenGuard`
  (`INTERNAL_API_TOKEN`) and the class-level `EventGuildScopeGuard`
  (`x-artemis-guild-id` must own the event; cross-guild -> 403).
- Actor identity is an **internal bot assertion**: the bot sets
  `x-artemis-actor-discord-id` from `interaction.user.id`
  (`ArtemisApi.getMySignup`). It is a header only, and the route rejects any
  query parameter. Headers ARE client-editable: this is not proof of identity.
  The internal token establishes caller trust, not the assertion header itself.
  Missing, empty, multi-valued or non-snowflake assertions are 400 before the
  participant view is loaded (the guild guard may first read event ownership).
- This is **not user authentication and not an OAuth/session endpoint.**
  Anyone holding `INTERNAL_API_TOKEN` can assert any actor, exactly as they can
  already pass `discordUserId` to every other bot-driven route. Caddy proxies
  `/api/v1/*` publicly (see `deploy/caddy/Caddyfile`), so the token remains the
  only barrier; a future web/OAuth "me" surface needs its own session-derived
  subject, and restricting `/api/v1` at the proxy is a separate hardening item.
  The API does not verify guild membership of the actor.
- Data minimization, enforced twice:
  1. `EventsService.getMySignup` loads with explicit `select` allow-lists and
     actor-bound `where` clauses (own RSVP by compound key, own tables by
     `ambassadorProfile.discordUserId`). It never loads roster, preferences,
     seating groups, audit logs, message jobs, eligibility rules or roles.
  2. `buildMySignupView` (pure, in `@artemis/domain`) is a whitelist
     projection that re-checks ownership of every row it is given. Tests feed
     it hostile input (other users' RSVPs/guests/tables, preference targets,
     audit/job/role data) and assert none of it appears.
- Returned: actor's registration role/category, own guests (name + seat state,
  no guest Discord ids), safe backup availability (a pending staffing pull
  appears as plain "available"), own tables, released own table/GM name,
  allowed actions. Not returned: other player identities, preferences/avoid
  targets, roster, audit, diagnostics, organizer ids.
- Preferences keep the existing ephemeral editing path; their targets are not
  in this view.

## Lifecycle guards added (API, regression-tested)

These paths were reachable from the new UI but unguarded server-side; hiding a
button is not enforcement:

- `rsvp`, `updateGuests`, `createTable` refuse COMPLETED / ARCHIVED /
  IN_PROGRESS events (CANCELLED already refused).
- `updateGuests` refuses after `assignmentLockedAt` (rules.md 6.4: guest
  changes after lock need organizer policy, none exists for participants).
  The web dashboard does not call this endpoint.
- `cancelRsvp` returns 404 (not a Prisma error) when the user has no RSVP and
  is idempotent for an already-cancelled RSVP (no duplicate audit row).
- `cancelRsvp` refuses organizer-removed (`REMOVED`) RSVPs with a safe 403
  before any write or Discord role change. Legacy `cancel_rsvp:` cannot convert
  removal into `CANCELLED` and thereby expose Join in the personal panel.
- Active cancellation is refused on cancelled/completed/archived/in-progress
  events. Existing pre-lock and post-lock player cancellation remains supported;
  it deactivates guests with the owner, rather than deleting their history.
- Cancel/rejoin reactivates the primary participant only; old guests stay inactive
  until the owner deliberately replaces the guest list.
- Preference writes AND deletes refuse locked, cancelled, running and terminal
  events, so stale preference controls cannot bypass the panel's restrictions.
- Signup, guest replacement and table create/edit fail closed on `LOCKED`,
  `assignmentLockedAt`, `DRAFT` or `SIGNUP_CLOSED`, including legacy paths.
- Existing active table owners cannot RSVP as player/backup; a backup player's
  table form cannot silently convert them into an active GM.
- Guest replacement requires an active RSVP. The UI explicitly describes whole
  list replacement, not additive edits; it is not a mixed Discord/name editor.

Late-signup/waitlist-after-lock is not implemented: until a committed-revision
policy exists, these participant operations refuse rather than silently rewrite
locked seating. These checks are not a concurrency-safe lifecycle redesign;
transactional lock/mutation races and automatic recalculation remain F01/F02.

## Dependency on P01a

Builds on `buildEventButtonRows` / vocabulary in
`packages/domain/src/event-presentation.ts` and the bot `event-post.ts` /
API `discord-event-post.service.ts` adapters. P01a's literal-button goldens in
the three adapter test files are updated here (that is the intended behavior
change). Revert this PR before reverting P01a.

## Deferred (P01 not complete)

- Canonical create/publish: `/event create` still replies publicly and does not
  persist `messageId`; the private organizer acknowledgment + single persisted
  public message ID work from the plan is untouched. Until then, slash-created
  posts are refreshed via the public message id carried in panel IDs.
- Actor-scoped GM table cancel/withdraw and "cancel backup availability only":
  no API path exists. The panel says to contact an organizer (GM) and does not
  show a backup-cancel button. Needs an API operation with capacity
  reassessment (rules.md 7.4).
- Seating-group (play-with) actions: no bot UI exists today; not added.
- The legacy preference editor persists selections; this slice does not fix the
  existing assignment engine's missing preferred-player behavior or Discord-DM
  selector versus table-ID preference mismatch. Do not advertise full preference
  allocation parity from the presence of an editor.
- Change-role (Player -> GM) as a single explicit flow with owned-guest
  handling: the panel requires cancel-then-run instead of a combined flow.
- Late signup/waitlist-after-lock workflow, automatic recalculation and committed
  notifications after player cancellation (F01/F02). API lock refusal is included.
- Reminder/notification choices (P02), ICS (P04).
- Per-category configuration beyond legacy Normal/Heroic and one generic
  category (Q01).
- Organizer-removed (`REMOVED`) users are shown a neutral "not active" and no
  Join; the legacy `rsvp:` path can still re-register them (existing behavior).
  Re-registration policy is unchanged by the cancellation guard.
- Legacy `backup_dm:` still resets an existing Heroic player's category to NORMAL.
  The new panel preserves the player's category; fixing the legacy handler is
  deferred, not included in this independent-review cancellation fix.
- GM-owned guest management after backup promotion and combined/mixed guest
  list editing remain deferred. Contact organizers for these cases.
- `main.ts` has an executed transport-faked harness of its actual
  `interactionCreate` callback: new public controls, legacy assignment/RSVP,
  actor/guild assertion headers, panel pick, canonical refresh, wrong actor,
  stale ID, guest replacement copy and immediate host-modal acknowledgment.
  It does not connect to Discord or prove gateway/live permission behavior.
- Slash-created posts without a persisted canonical ID can only be refreshed
  while a public-message hint survives. Legacy guest/host subflows do not carry
  that hint end to end; canonical published posts refresh by persisted identity.
  Repairing create/publish is required to remove this fallback limitation.

## Manual Discord checklist (not run; needs a test guild)

Post shows only Join / Run a table / My signup; Join -> choose -> panel;
guests/preferences open from the panel; backup opt-in then cancel; cancel
confirm; locked event shows My signup only; cancelled event has no buttons;
an old post's legacy buttons still work; counts on the public post update after
join/cancel while the ephemeral panel stays intact.

## Test evidence

The interrupted worker left code/tests, not a verified completion or commit.
Its historical RED/GREEN sequence was not independently recovered and is not
claimed here. The continuation established an actual passing inherited suite.

New behavioral RED/GREEN evidence was executed in this continuation:

- API safety: 13 failing behavioral regressions, then 13 passing (preferences,
  terminal cancellation, rejoin eligibility, exclusivity and cancelled guests).
- Signup lock follow-up: 4 failures / 13 passes, then all 17 passing.
- Actual router + panel: 3 failures / 32 passes (modal before network, public
  panel refusal, missing Join controls), then GREEN including handler tests.
- Guest copy + waitlist projection: 2 failures / 43 passes, then GREEN.

Exact final gate counts, commands, warnings and log paths are in the result JSON.
Final full `npm test`: 29 files passed, 420 tests passed. Typecheck, lint,
`check:deploy`, full build and focused Prettier check all exited 0.
Full tests run with the repository's default timeout, never a global increase.
Typecheck/build include Prisma client generation; no migration was run. No live
Discord, PostgreSQL, production health or `/ops check` verification is claimed.
Verification runtime: Node `v26.4.0`, npm `11.17.0`, not CI's Node 24 runtime.
Focused Prettier covers all new files and changed presentation/adapter tests.
The controller, service, bot API, main and domain index still have formatting
warnings also present in the base revision; whole-file reformatting is excluded
to avoid unrelated churn. No test timeout was increased or tests weakened.

## Independent-review cancellation fix evidence

Scope: only the forbidden `REMOVED -> CANCELLED` transition, reproduced against
`e2b2342079441ff05f40b341e38cfbe73db752ab`. No schema, dependency, configuration,
re-registration policy, assignment/recalculation or legacy backup-handler changes.

- Added a behavioral regression beside the existing cancellation tests in
  `apps/api/src/events/participant-lifecycle.test.ts`, invoking the real
  `EventsService.cancelRsvp` with faked persistence (no live database).
- RED: `npm test -- apps/api/src/events/participant-lifecycle.test.ts` exited 1:
  1 failed / 15 passed. The new rejection assertion instead received
  `{ id: 'r1', status: 'CANCELLED' }`, confirming the review finding before the fix.
- Minimal fix: reject `REMOVED` with `ForbiddenException` (403) before mutation.
- GREEN: the same focused command exited 0, 16 tests passed. The regression
  checks the safe status/message, unchanged REMOVED status, no RSVP update or
  transaction (including nested participant/audit writes), and no role lookup.
  Existing active cancellation and already-cancelled idempotency remain green.
- Full `npm test` exited 0: 29 files / 421 tests passed at the default timeout.
- `npm run lint`, `npm run typecheck`, `npm run check:deploy` and
  `git diff --check` exited 0. Typecheck generated the local Prisma client;
  no migration or deployment was run.
- Existing Vite config-loader warning remains; Git also reported LF-to-CRLF
  normalization for the test file. No timeout, test configuration or test
  expectations were weakened. No live Discord or PostgreSQL verification.

## Rollback

Revert this stacked PR (before reverting P01a). No schema, data, or config
change; no deploy ordering requirement. Posts already published with the new
buttons would show unknown-button replies after a revert until republished
(the old bot treats `join:`/`run_table:`/`my_signup:` as unknown), so republish
active posts after rollback.
