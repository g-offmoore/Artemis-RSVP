# Feature parity implementation plan

## Scope and baseline

Planning baseline for the implementation rollout tracked in [issue #21](https://github.com/g-offmoore/Artemis-RSVP/issues/21). The owner subsequently authorized implementation in isolated sessions and separate PRs. This document is the design baseline, not evidence that any feature is implemented or deployed. Production deployment, destructive migrations, and automatic merges remain out of scope.

- Input: `C:\Users\airma\Downloads\Artemis vs Apollo and Sesh.md`, competitive review dated 14 Nov 2026.
- Inspected checkout: `master` at `529b5a7`, initially clean. This is the same revision cited in the comparison, not a newer baseline.
- Product authority: `rules.md`; existing gap tracker: `docs/PRODUCT_FEEDBACK_TODOS.md`. The gap tracker's `5c64de9` baseline is stale relative to the inspected checkout; re-audit each TODO rather than treating it as proof of missing functionality.
- Architecture: NestJS API owns writes, Discord.js bot and Next.js dashboard call that API, Prisma/PostgreSQL owns state, pg-boss schedules work, and `packages/domain` owns shared policy.
- Competitive pricing/capabilities are treated as input assertions, not independently reverified market facts.

**Recommendation:** preserve the source's player-first strategy, but add a reliability foundation before new outbound messaging. Start the personal-panel work alongside that foundation. Do not describe all Phase 1 features as small: notification durability, private feeds, and templates each introduce meaningful state and security work.

## 1. Findings that change the proposed roadmap

| Finding                                                                                                                         | Code evidence                                                                                                                                                          | Planning consequence                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment DMs already use persistent per-recipient jobs, but reliability is incomplete.                                        | `message-job-worker.service.ts`: `runAssignmentLock`, `scheduleAssignmentNotifications`; `message-jobs.service.ts`: `processDueJobs`                                   | Extend the existing path; do not build another notification subsystem. Fix claim/retry and transaction gaps first.                              |
| One job per event/type/target cannot represent several reminders to one person or repeated committed assignment revisions.      | `packages/db/prisma/schema.prisma`: `EventMessageJob.@@unique([eventId, messageType, targetId])`                                                                       | Introduce logical delivery identity including reminder/revision identity and destination type. Merely adding `PLAYER_REMINDER` is insufficient. |
| Due jobs are read then sent without a row lease; failed rows are not automatically retried.                                     | `MessageJobsService.processDueJobs`, `markFailed`                                                                                                                      | Add atomic claims, retries, recovery, and operational retry UI. pg-boss retries of a successful poll do not repair individual failed rows.      |
| Lock commits separately from notification creation; already-locked retry skips enqueue. Manual lock bypasses that enqueue path. | `EventsService.lockAssignments`; worker `runAssignmentLock`                                                                                                            | Move committed transition + delivery intent into one application transaction shared by manual and scheduled operations.                         |
| Assignment lock timing has competing definitions.                                                                               | Schema default `assignmentLockOffsetMinutes=120`; scheduler calls `computeAssignmentLockScheduledFor` with a 60-minute default; preflight computes 60 minutes directly | Define one effective lock-time policy; preserve intentional overrides and migrate defaults explicitly.                                          |
| Thread auto-add is already attempted on RSVP.                                                                                   | `EventsService.rsvp` calls `DiscordRoleService.addMemberToThread`                                                                                                      | Correct the comparison's missing-feature claim: remaining work is durable membership sync, cancellation removal, and recovery/backfill.         |
| Series duplicate detection is check-then-create, not a DB guarantee.                                                            | `EventSeriesService.generate`; `Event` lacks occurrence uniqueness                                                                                                     | Fix stable occurrence identity and concurrency before broader recurrence or auto-publication.                                                   |
| Vocabulary, embeds, and controls are duplicated.                                                                                | `apps/bot/src/main.ts`; `discord-event-post.service.ts`; vocabulary also in web `actions.ts` and `event-management.tsx`                                                | Extract shared presentation contracts before redesign; retain legacy button routing.                                                            |
| Channel pickers exist, but role fields and series channel input still use raw IDs.                                              | `GuildChannelsService`; web create/settings forms; series create and eligibility forms                                                                                 | Reuse the existing channel flow rather than rebuilding onboarding from scratch.                                                                 |
| Internal API authentication is not player authentication.                                                                       | `ApiTokenGuard`, `GuildScopeGuard`, web `auth.ts`                                                                                                                      | A new `/me`, feed, or public RSVP route needs explicit actor/subject authorization; a supplied user ID is not identity proof.                   |

Paths without a prefix in this table are under `apps/api/src/events`.

## 2. Non-negotiable design constraints

1. Active occurrence GM offers determine compatible seating capacity. Custom option caps are registration limits, not guaranteed table seats. Backup offers never double-count active capacity.
2. Fresh RSVP per occurrence; campaign membership, subscriptions, templates, and recurring schedules never silently register anyone.
3. Built-in behavioral classes remain explicit. Configurable labels map to behavior; adding a label must not add an enum state machine. Observer behavior requires an intentional policy before exposure.
4. Only committed, released changes generate participant notifications. Draft recalculation and private preferences remain private. Shared public availability must not imply a guaranteed seat.
5. API/domain enforce eligibility, windows, capacity, actor ownership, and lifecycle transitions independently of Discord or web controls.
6. Retain one event-wide discussion space by default. Per-table spaces are optional later scope, not a replacement for the existing model.
7. Do not use participation/attendance history to determine, score, or recommend GM eligibility. `rules.md` §§5.4, 7.2, 14.2 prohibit that. Aggregate load reporting is informational only.
8. Keep deployment migration-first and compatible with briefly mixed old/new clients. Follow the actual CI-image deployment flow in `docs/OPERATIONS.md` and `scripts/deploy-nanode.sh`; `rules.md` still describes an older build-first sequence. Align that documentation deliberately before implementation changes to deployment.

## 3. Delivery sequence and release gates

Effort labels are relative, not calendar commitments: S = localized change; M = cross-service slice; L = new durable workflow or significant migration; XL = multi-release product/schema work. Estimates assume focused engineering plus tests and require refinement after the first reliability slice.

| Release                         | Work packages | Exit gate                                                                                                                                                  |
| ------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0 — Trustworthy operations     | F01–F04       | Concurrent workers, restart recovery, lifecycle invalidation, occurrence identity, and diagnostics pass real PostgreSQL integration tests.                 |
| R1 — Player-facing parity       | P01–P07       | Players can join/manage signup, receive permitted reminders, subscribe privately, and see current public information without duplicate or leaked messages. |
| R2 — Flexible programs          | Q01–Q08       | Configurable options, recurrence, and post-lock changes preserve capacity, history, and assignment stability.                                              |
| R3 — Operations differentiation | M01–M05       | Attendance-to-next-session loop and explainable reporting work end to end under scoped permissions.                                                        |
| R4 — Expansion                  | M06–M07       | Public identity/abuse model and organization tenancy are separately approved and tested.                                                                   |

Parallelism: P01 pure presentation extraction and P05 copy/template design can proceed during R0. P03 parser tests can also proceed independently. New DM fanout, digest updates, and public subscription routes must not ship before their relevant R0 gates. Q01 and Q02 may proceed independently after the foundation; Q03 depends on committed revisions, capacity policy, and notification delivery.

### R0: reliability and policy foundation

**F01 — Canonical policy and transition contracts [M]**

- Touch: `packages/domain/src/index.ts`, datetime/assignment tests, `schema.prisma`, `EventsService`, `rules.md` only where an intentional decision changes it.
- Define effective timezone and lock time, copied/inherited/overridden series fields, participant status projection, published/released boundary, priority tie-breaking, signup timestamp preservation, reschedule and cancellation behavior.
- Persist event/series timezone snapshots going forward; backfill legacy values from guild settings with provenance, since historical original timezones may be unknowable. Guild timezone edits must not silently move existing events.
- Proposed default: one-hour assignment lock for new events, explicit per-event override; one shared helper for scheduler, web, and Discord. Audit legacy 120-minute values before changing them rather than resetting all events.
- Done: the same inputs yield the same status/lock/window in API, Discord, and web; cancellation blocks new participant operations; completed-event policy is explicit.

**F02 — Durable deliveries and committed revisions [L]**

- Touch: schema/migrations, `message-jobs.service.ts`, worker, `events.service.ts`, `JobsService`, metrics, new focused delivery/revision services.
- Add stable logical delivery keys, committed revision/change identity, payload/reference version, attempt count, next-attempt time, lease owner/expiry, terminal disposition, sanitized error, and remote message ID where meaningful. Separate schedule identity from recipient delivery identity if that keeps fanout manageable.
- Claim a bounded batch atomically using PostgreSQL row locking/conditional updates; recover expired leases. Use bounded exponential backoff with jitter, Discord rate-limit retry timing, and terminal blocked-DM handling. Do not let optional messaging starve assignment work.
- Commit canonical state, audit/revision, and outbox intent in one transaction. Manual lock and scheduled lock call the same application operation. Unknown job types fail visibly, never become silently sent.
- Revalidate cancellation, revision currency, reminder preference, and recipient participation before dispatch; supersede stale intents on edits. Do not mark a business transition failed merely because a DM is blocked.
- Delivery guarantee: durable at-least-once processing with logical dedupe, not an unsupported promise of exactly-once Discord delivery. Document the send-success/persistence-crash uncertainty; use remote idempotency only where verified supported, and reconcile editable messages by stored identity.
- Done: two workers do not concurrently own one delivery; crash after commit loses no intent; retries never emit draft state; every supported committed status change has an auditable recipient outcome. Real PostgreSQL tests cover claim/recovery, not only mocks.

**F03 — Concurrent occurrence generation and publication safety [L]**

- Touch: `EventSeriesService.generate`, event creation/publish services, schema and migrations.
- Give an occurrence a stable original slot key independent of its editable `startAt`; enforce uniqueness within the series. Initialize recurrence anchors under a series lock. Add generation-request idempotency so retrying one request does not append a new batch.
- Preserve cancelled/skipped slot tombstones; moving or cancelling one occurrence must not regenerate its original slot or shift alternating cadence.
- Create occurrence/config snapshots and provisioning intent transactionally. Serialize public post/role/thread creation; store/reconcile remote IDs and uncertain outcomes rather than assuming a DB unique constraint prevents duplicate remote objects.
- Recover empty/expired series explicitly and define lookahead publication policy; do not silently switch on automatic publication for existing series.
- Done: simultaneous generation requests create one occurrence per intended slot; retries return the same batch; DST and anchor tests pass; duplicate publication/provisioning is detected and repairable.

**F04 — Discord reconciliation and failure dashboard [M/L]**

- Touch: `discord-role.service.ts`, `discord-event-post.service.ts`, `EventsService.discordSyncFailures`, controller, web event/operations surfaces, `/ops check`.
- Persist desired versus observed post, role, thread, and membership state with last-attempt/next-retry timestamps. Add staff-only retry/reconcile actions scoped to exact targets.
- Repair thread membership after delayed provisioning; remove cancelled users unless another authorized event role warrants access. Guests without a Discord identity have no membership action; linked guests require explicit policy.
- Never mark role deletion successful after a failed DELETE. Distinguish missing remote object from permission denial; do not redirect to another channel silently.
- Decouple critical scheduling from `DISCORD_TOKEN` gating: lock/state jobs must continue and expose delivery failures separately.
- Done: simulate bot/API downtime, deleted messages, denied permissions, role removal failure, and delayed thread creation; staff see exact failure and can recover without public diagnostics.

### R1: table stakes

**P01 — Simplified post and personal signup panel [M; depends F01]**

- Extract framework-neutral presentation/view models and component descriptors shared by bot/API; do not put Discord REST calls in the domain package. Adapt descriptors in each delivery surface.
- Public controls: `Join`, `Run a table`, `My signup`. `Join` opens an ephemeral category/guest/group flow; keep the first join path short and optional details editable afterward.
- Add a participant-safe view returning only the actor's registration, guests, released assignment, safe waitlist explanation, backup availability, notification choices, and allowed next actions. Resolve the actor from a trusted bot assertion or authenticated web session; do not expose arbitrary-user lookup as public `/me`.
- Personal controls are state-aware; role changes, guest handling, and backup consent stay explicit. Retain old custom IDs for already-posted messages. Defer privately before slow work and handle stale panels safely.
- Fix the create-command publication path at the same boundary: private organizer acknowledgment, canonical publish operation, and one persisted public message ID, rather than a second public interaction reply path.
- Done: no registration, player, player+backup, active GM, waitlisted, locked, cancelled, and completed scenarios show correct controls; both post builders match; unauthorized actor and cross-guild tests fail closed.

**P02 — Confirmation DMs and configurable attendee reminders [L; depends F02]**

- Add separate RSVP-confirmation and attendee-reminder kinds; preserve private organizer `REMINDER` semantics. Store per-event/series reminder policies with stable IDs, offsets, safe custom text, maximum count, and snapshot/override behavior.
- Proposed defaults: confirmation DM after committed signup and one 24-hour reminder, with per-guild-user controls and per-event opt-out; explicitly document consent/defaults before enabling existing guilds. Keep necessary committed status-change messages distinct from optional nudges.
- Fan out to eligible current participants; dedupe one Discord user across participant representations. Name-only guests are communicated through the owner. Give waitlisted players accurate waitlist reminders, not confirmed-seat language.
- Late signups do not receive all expired reminders. Cancellation suppresses pending optional deliveries; reschedule invalidates old policy/time revisions and produces the required committed change notice.
- Done: several offsets reach the same person without key collision; unsubscribe and cancellation win dispatch rechecks; blocked DMs are visible without rolling back RSVP; no organizer warning enters player copy.

**P03 — Natural-language dates with preview/confirm [M; depends F01]**

- Add `chrono-node` behind a shared parser adapter; retain structured date input. Accept exactly one input path, explicit reference instant, IANA zone, and duration/default duration.
- Interpret parsed wall-clock components in the guild/event zone with existing timezone utilities; never use the process-local timezone implicitly. Reject or explicitly disambiguate DST gaps/folds, ambiguous input, past starts, and invalid durations.
- Private preview shows absolute local date, zone, duration, and Discord timestamps. Persist an expiring actor-bound preview token or use a signed payload with replay protection; avoid an in-memory-only confirmation state. Confirm reauthorizes, revalidates and creates/publishes idempotently through the canonical API. No public post before confirmation.
- Touch: domain datetime tests, bot command registration/handlers and API client, web create form/actions, API preview/confirm service.
- Done: examples `fri 6pm` and `next saturday 1pm for 4h`, timezone mismatch, DST transitions, token expiry/replay, wrong actor, and duplicate confirm pass tests. Re-register slash commands on rollout.

**P04 — Guild, series, and personal ICS feeds [M/L; depends F01 and security review]**

- New calendar module, feed subscription/token model, public read-only controller, dashboard/personal-panel subscription management. API response is `text/calendar`, not the existing JSON client contract.
- Use cryptographically random revocable capability tokens stored as hashes, bound to scope and optional subject; do not use the internal API token or expose enumerable personal feed IDs. A signed URL alone still needs revocation/versioning. Redact URLs from logs; private caching and rate limits apply.
- Public guild/series feeds are opt-in published event projections. Personal feeds include only the subscriber's eligible events and released table/GM details. Never include guest names, preferences, audit data, or unpublished seating.
- Stable UID per event, consistent DTSTAMP/LAST-MODIFIED, monotonic SEQUENCE, correct escaping/UTF-8 line folding, UTC or valid TZID representation, and cancellation retention. Document client polling lag and that ICS is one-way, not instant Google sync.
- Review `ApiTokenGuard` and `GuildScopeGuard` public bypass: route-specific token authorization must replace, not simply remove, protection. Confirm Caddy path routing.
- Done: parse generated feeds with an independent calendar parser; edits retain UID and increment revision; cancellations propagate; revoked tokens stop working; no cross-guild/subject/private-field leakage.

**P05 — Duplicate event and reusable templates [M; depends F01/F03 publication boundary]**

- Add API duplicate/save-template/create-from-template operations and web actions. New `EventTemplate` stores allowed configuration only; reuse copy-on-write EventType utilities and policy snapshots.
- Duplicate creates a draft with new timing and IDs. Copy title/description/image/program/options/approved defaults, not participants, assignments, attendance, audit history, message/thread/role IDs, notification deliveries, or an implicit live GM offer. Do not keep series membership unless explicitly requested through a supported workflow.
- Templates and duplicate endpoints require guild authorization and idempotency keys. Draft creation must not emit participant reminders or public content; inspect current create-time provisioning before reuse.
- Done: editing the duplicate/template does not mutate the source; no unexpected public post or inherited registration; review copied versus reset fields in a test fixture.

**P06 — Finish thread membership parity [M; depends F04]**

- Promote the existing RSVP auto-add attempt into durable desired-state membership; add cancellation removal, late-provisioning backfill, retry, organizer visibility, and GM/backup policy coverage.
- Thread membership is independent of a user's assigned table; reassignment does not remove their event role. Do not assume assigning a Discord role itself adds private-thread membership.
- Done: join/cancel/rejoin, waitlist, backup promotion, deleted thread, and permission recovery converge to the intended member set.

**P07 — Pinned live weekly digest [M; depends F02/F04]**

- Store one configured channel/message binding per digest with a guild-local weekly window. Coalesce event/RSVP/capacity changes into bounded debounced edits and run periodic repair.
- Reuse the canonical public projection: compatible availability, tentative versus released states, and links. No private shortage logic or participant metadata. Paginate within Discord limits, suppress arbitrary mentions, and make pin permission failure recoverable.
- Done: new/edit/cancel/signup changes update the existing message, not create spam; restart rebuilds it; 429 and missing-message recovery are observable.

### R2: premium parity and remaining matrix gaps

| ID / effort | Implementation slice and primary surfaces                                                                                                                                                                                                                                                                                                                                                                                                   | Dependencies / acceptance                                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q01 / XL    | Configurable participation options and categories: new option/category/compatibility records owned by the EventType snapshot; option IDs on RSVP/participant/table as needed; API validation, series snapshot copy, both signup panels, shared vocabulary, seating adapter. Label, emoji, registration cap, role gate, reminders, ordering, and behavior mapping. Retire fixed enum dependence gradually, not in one destructive migration. | F01–F03. Backfill legacy options; keep legacy payload mapping during rollout. Concurrent option-cap enforcement; safe option retirement; no stranded registrations; category compatibility and hard seat limits preserved. Observer semantics must be approved first.        |
| Q02 / L     | Versioned recurrence specification: daily/weekly intervals, multiple weekdays, monthly date/nth weekday, yearly, explicit skip/holiday dates, alternating programs, anchored timezone, end/count bounds. Offer a bounded preview before save. Stable slot identity and template revision make `this occurrence`, `this and following`, and `template only` explicit.                                                                        | F03. Preserve legacy WEEKLY strings with an adapter; fifth weekday/month-end/leap-year/DST tests; skipped slots never regenerate; overrides and history survive future-series edits.                                                                                         |
| Q03 / L     | Table-aware waitlist offers with claim window: durable offer/reservation/expiry records and conditional claim transaction; protected committed assignment revisions and notification diff. Reserve all necessary party seats atomically; expiry/decline advances deterministically.                                                                                                                                                         | F01/F02, capacity ownership/priority policy. Two claims cannot take one seat; expired offers cannot claim; preference/eligibility recheck; GM withdrawal invalidates unsafe offers; no silent displacement or hard-cap breach.                                               |
| Q04 / M     | Native Discord Scheduled Events mirror: separate remote native-event ID, desired revision/status, create/update/cancel/complete reconciliation, explicit permission diagnostics. Artemis remains authoritative; Discord “interested” is not an Artemis RSVP.                                                                                                                                                                                | F04. Repeated sync does not create duplicates; cancelled/time-changed events mirror; reverse RSVP import is out of scope. Verify current Discord API/permission details during implementation.                                                                               |
| Q05 / L     | Campaign time poll: campaign-scoped proposed slots/votes/deadline and eligible voter policy; private button UI; explicit GM selection converts chosen slot to a draft event with campaign/table configuration.                                                                                                                                                                                                                              | F01/F02 plus formal campaign membership/lifecycle workflow. One vote policy, timezone clarity, unauthorized vote rejection, idempotent conversion; membership/vote never creates RSVP or active GM capacity.                                                                 |
| Q06 / S–M   | Authorized CSV exports for event/series/date-range RSVPs, assignments, and attendance; server-side projection and streaming/pagination; download actions on event/series/report surfaces.                                                                                                                                                                                                                                                   | Stable status projection. Enforce guild/scope and date bounds, escape CSV/formula injection, exclude private preferences/notes by default, audit exports; empty and large result tests. Can ship before other R2 work.                                                       |
| Q07 / M     | Setup wizard: shared ops diagnostics exposed through authenticated API; channel/role/member selectors replacing raw-ID defaults; role hierarchy, intent/permission, channel visibility, timezone, and test-event checklist.                                                                                                                                                                                                                 | F04 and auth review. Reuse existing channel service/proxy; protect roles/member lookups; distinguish assignable roles from roles valid as eligibility gates; unresolved/deleted selections remain visible as broken. Never weaken admin access when role selection is empty. |
| Q08 / M     | Single-event scheduled publication: `publishAt` and policy revision, pending job, private preview, cancel/reschedule handling; series auto-publication becomes an explicit separate policy.                                                                                                                                                                                                                                                 | F02/F03. Draft stays private until due; worker rechecks status/authorization/config; retry does not double post; cancelled schedule never publishes. This is a matrix gap omitted from the source's numbered roadmap.                                                        |

Additional Q01 scope: custom signup questions use versioned question/answer records, validation, optionality, visibility/retention, and capacity-neutral semantics. Sensitive answers must not appear in public posts, feeds, generic CSV, or analytics. Ship this after option behavior is stable rather than mixing it into the initial enum migration.

### R3/R4: protect and extend the operations moat

| ID / effort    | Deliverable                                                                                                                                                                                                                                                     | Prerequisite and exit criteria                                                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M01 / L        | Post-event loop: GM table-scoped attendance actions, bounded correction window, feedback request lifecycle, optional next-session notification and explicit one-click RSVP.                                                                                     | Durable deliveries, scoped attendance capability, campaign/series identity. Attendance submitted once per participant; feedback consent/expiry respected; current eligibility/windows checked on next RSVP; no automatic reservation.               |
| M02 / M then L | Player history and reliability reporting, with denominators, excused/cancelled distinction, correction and privacy policy. Optional waitlist-first/no-show policy is a separate approved change.                                                                | Stable attendance data and authorized access. Start reporting-only; never infer GM eligibility. Any sanction policy needs notice, appeal, duration/reset, minimum evidence, and explicit `rules.md` review before implementation.                   |
| M03 / M        | Organizer analytics: attendance, new/returning players, fill rate by program, GM load, cancellations and no-shows. Define registered versus seated versus attended denominators and cohorts; start with indexed SQL, add aggregates only if measured necessary. | Corrected event/attendance history; scope-aware reporting. Cross-check against known fixtures, no private preference exposure, missing data visibly excluded. No inferred financial “no-show cost” without organizer-provided assumptions.          |
| M04 / M        | Earlier staffing alerts with approved one-click recruitment/backup actions; use actual compatible hard capacity and the same seating-policy projections, not exact-category counts.                                                                             | Durable delivery and eligibility checks. Configurable offsets, consent-aware actions, safe mention limits, current-state revalidation. Fix existing mixed-table “NO DM” false positives and hard-coded “24-hour” text.                              |
| M05 / M        | Explainable player/staff status projections using structured reason codes and committed revisions; safe next actions and stable shared copy.                                                                                                                    | Start basic copy in F01/P01; deepen with revisions. Players never receive avoid-player, eligibility, or staffing internals. Do not show a simplistic global queue number when compatibility means there is no single queue.                         |
| M06 / XL       | Public event pages, store calendar embed, then authenticated external RSVP. Separate public read projection from mutation APIs; explicit Discord-account linking, guests, invites, abuse controls, CORS/frame policy, rate limits, and accessibility.           | Approve identity/privacy model first. Anonymous reads cannot reach internal API; external RSVP calls the same domain rules and cannot spoof Discord identity. Initially ship read-only pages/embed plus invite rather than unverified seat booking. |
| M07 / XL       | Organization/location tenancy, explicit guild bindings, scoped manager grants, shared GM directory, combined reporting, optional cross-post bindings.                                                                                                           | New tenancy design and scope enforcement before shared data. One canonical occurrence cannot accidentally double-count RSVPs/capacity across mirrors; no cross-org reads/writes. Existing guild isolation is not complete multi-store support.      |

Scoped delegated administration is a cross-cutting prerequisite: keep existing staff/admin authorization for initial controlled-guild releases, but implement and test event/series/table/attendance/settings capabilities before advertising delegated management, table-scoped GM corrections, or multi-store access. A capability grant must never imply control over unrelated guild programs.

## 4. Explicit deferrals and source coverage

- **Google Calendar sync:** ICS is the first integration. Defer automatic one-way/two-way Google sync until feed adoption justifies OAuth/token storage, external identity mapping, conflict resolution, delete/reschedule rules, and webhook renewal. ICS does not claim two-way parity.
- **AI create/list command:** not needed for deterministic natural-language time parity. Defer until permissions, preview/confirmation, data access, abuse/rate limits, and model cost policy have a separately approved design.
- **Public API/webhooks:** current internal token-auth API and ops webhook are not a customer API. Later work needs per-tenant credentials/scopes, versioned safe projections, quotas, revocation, signed deliveries, replay protection, and retry visibility.
- **Custom bot branding:** self-hosted branding already exists; hosted per-tenant branding is a different deployment/product problem and is not a feature-parity priority.
- **Per-table channels/threads:** optional after event-wide membership works; require ACL/lifecycle and orphan cleanup design.
- **General polls/time finder:** campaign polling Q05 is the first supported slice; generic server-wide polling can follow demand.
- **Commercial tiers/pricing:** do not introduce entitlements or billing based solely on competitor prices; this plan prioritizes functionality and reliability.

Coverage: source Phase 1 maps to P01–P07; Phase 2 maps to Q01–Q07; Phase 3 maps to M01–M07. Scheduled publication, custom questions, delegated scopes, API/webhooks, AI, Google sync, and branding from the wider matrix are addressed explicitly above. Existing features are retained, not rebuilt merely for checklist parity.

## 5. Migration and rollout strategy

1. Add schema fields/tables/indexes with legacy compatibility; do not drop role/category enums or old job keys before all callers migrate. New logical keys require duplicate/conflict preflight and an idempotent backfill.
2. Backfill occurrence slots, timezone provenance, default options, policy snapshots, and delivery identities. Audit ambiguous legacy data into a repair report; never silently discard duplicate events, RSVPs, or history to satisfy a unique index.
3. Register unique constraints after repair and deploy readers/adapters capable of both representations. New structured recurrence is versioned; old weekly/biweekly values remain readable.
4. Keep new fanout/public routes behind default-off per-guild rollout flags. Enable a test guild, verify state/readbacks and rates, then expand. Migrate unsent jobs carefully so legacy/new workers cannot both send them.
5. Roll back by disabling the new feature/workers while preserving additive schema and committed history; do not promise safe binary rollback after new states are written without a compatibility check.
6. Update `docs/PRODUCT_FEEDBACK_TODOS.md` only as acceptance gates actually pass; record corrected baseline and cross-link completed slices. Update `docs/DISCORD_ACCEPTANCE.md`, `docs/OPERATIONS.md`, and security notes as each slice changes behavior.

## 6. Verification and definition of done

### Baseline actually executed for this planning task

- `npm test -- --reporter=dot`: initial run had 175 passing tests and one AppModule dependency-graph startup test exceeding its default 5-second timeout.
- `npm test -- --reporter=dot --testTimeout=30000`: 176 tests passed across 14 files. This successful rerun does not prove the default-timeout issue is fixed; no test configuration was changed.
- `npm run check:deploy`: runtime import declarations, Compose environment contract, and migration-file checks passed. This is static validation, not a deployed-system smoke test.
- Runtime observed: Node `v26.4.0`, npm `11.17.0`. CI targets Node 24; reproduce implementation acceptance under the CI runtime.
- No live PostgreSQL concurrency tests, full build/typecheck/lint, Discord acceptance, migration execution, calendar-client interoperability, or production `/ops check` were run for this plan.

### Required automated gates per implementation slice

- Test-first domain/API behavior, negative authorization and lifecycle cases, then integration tests against real PostgreSQL for leases, uniqueness, locks, transactions, and simultaneous claims.
- Bot interaction harness covering private deferral, legacy IDs, expired panels/confirmations, published-message identity, and safe error handling. Web tests for actions/proxies, selector states, scope denials, and accessibility.
- Fault injection: stop after commit/before enqueue, after remote accept/before local success, lease expiry, process restart, cancellation/reschedule racing dispatch, Discord 429/5xx/403/404, and remote object deletion.
- Calendar parser interoperability, CSV injection tests, token revocation, private-field projection tests, and cross-guild/subject isolation.
- Run the repository verification contract: Prisma generate, `check:deploy`, typecheck, tests, lint, build, CI Docker runtime checks, and audit gate. Add a PostgreSQL integration job rather than assuming current mocked tests exercise the database.

### Required deployment/manual gate

Use migrations and the existing CI-built image deploy flow; verify API/web health, bot startup, and `/ops check`. In a test Discord guild: create draft, preview/confirm, publish twice, join/guest/backup/cancel/rejoin, hit lock, trigger one committed revision, exercise waitlist claim/expiry, reschedule/cancel, recover membership after downtime, subscribe/revoke a feed, and finish attendance/feedback/next-RSVP where supported. Read back both canonical state and actual Discord objects. Production readiness is not inferred from passing unit tests.

## 7. Decisions and first implementation batch

No clarification is needed to begin F01 discovery, tests, and the shared presentation extraction. The following are proposed defaults, not claims that product decisions are already approved:

| Decision                          | Proposed default                                                                                                                                        | Must settle before             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Notification consent/defaults     | Separate optional confirmations/reminders from necessary committed changes; per-guild-user controls; opt-in rollout for existing guilds                 | P02 enablement                 |
| Priority and claim window         | Preserve original registration order on edits; stable compatibility-aware queue; 30-minute claim maximum bounded by event start; organizer-configurable | Q03 implementation             |
| Category/observer semantics       | Labels map to existing built-in behavior first; explicitly define observer assignment/attendance before exposing it                                     | Q01 schema finalization        |
| Series edit scope                 | Snapshot occurrences; explicit future scope; never silently rewrite past events or RSVP state                                                           | Q02                            |
| Personal feed content             | Own published events and released seat details only, revocable token, no other player identities                                                        | P04                            |
| Reliability penalties             | Reporting-only initially; no automatic sanctions or GM eligibility inference                                                                            | M02 policy phase               |
| Deployment documentation mismatch | Preserve actual CI-image operational flow; intentionally align the stable contract rather than editing deployment implicitly                            | Any deployment workflow change |

**First implementation batch:** (1) F01 policy/lock-time tests and contracts; (2) F02 schema/claim/retry primitives and transaction-bound delivery intent; (3) F03 occurrence identity/concurrency; (4) F04 repair surface plus membership state; (5) P01 shared presentation and personal panel, then P02 attendee reminders. This yields a dependable first player-facing release without starting the highest-risk category migration prematurely.
