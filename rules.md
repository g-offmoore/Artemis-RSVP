# Artemis Project Rules

This file defines the expected behavior, product boundaries, and engineering rules for Artemis. It is intended to be placed at the repository root as `rules.md` and referenced by all developers, code reviewers, and coding agents before changing event, RSVP, assignment, notification, web UI, Discord UI, or deployment logic.

When this file conflicts with an implementation detail, the implementation is wrong unless this file has first been intentionally updated.

## 1. Product intent

Artemis is a Discord-first event operations system with a web organizer dashboard. Its job is to help organizers run tabletop roleplaying game events with clear signup flows, reliable capacity management, correct table assignment, private organizer operations, and predictable player-facing communication.

Artemis must be boring, consistent, and trustworthy. It should avoid surprising players, leaking organizer-only information, over-promising capacity, or requiring organizers to mentally reconcile mismatched Discord and web state.

The acceptable product outcome is not merely that commands run without crashing. The acceptable outcome is that an organizer can create, publish, monitor, assign, adjust, and close an event without hidden state mismatches or public operational noise.

## 2. Deployment and runtime assumptions

The production deployment model is based on the provided deploy script and must be respected by application design.

Production runs from:

```bash
/opt/artemis/repo
```

Deployment uses Docker Compose with:

```bash
docker compose --env-file /etc/artemis/production.env
```

The expected deploy flow is:

1. Confirm current container status.
2. Confirm the Git working tree is clean.
3. Pull with `git pull --ff-only`.
4. Render Compose config and fail if unresolved variables remain.
5. Build with the `migrate` profile.
6. Run migrations before restarting application services.
7. Restart API and verify API health.
8. Restart web and verify web health.
9. Restart Caddy.
10. Restart bot.
11. Show final service status, Docker stats, memory, and disk usage.
12. Run `/ops check` in Discord after deployment.

The application must therefore support this operational model:

- API, web, bot, migration, and Caddy are separate Compose services.
- Database migrations must be safe to run before service restarts.
- API and web must expose meaningful Docker health checks.
- Bot startup must be idempotent after API/web restart.
- Production jobs must survive service restarts without duplicate destructive behavior.
- Runtime configuration comes from `/etc/artemis/production.env`.
- Deploys must fail fast on dirty working trees, unresolved Compose variables, failed migrations, or unhealthy API/web services.
- `/ops check` must be treated as the post-deploy smoke test entrypoint.

No feature is production-ready until it works under this deployment flow.

## 3. Repository-level expectations

Artemis is expected to behave like a single product even though it has multiple services.

Expected monorepo responsibilities:

- `apps/api`: authoritative application API and service orchestration.
- `apps/bot`: Discord interaction and notification surface.
- `apps/web`: organizer-facing web dashboard.
- `packages/db`: database schema, migrations, and persistence access.
- `packages/domain`: event, RSVP, guest, assignment, capacity, permission, attendance, and audit rules.

Domain decisions must live in shared domain/application services, not separately and inconsistently in Discord handlers and web routes.

Discord and web may present different UI affordances, but they must call the same underlying rules.

## 4. Non-negotiable engineering principles

### 4.1 Domain integrity beats UI convenience

If a user action would create invalid state, reject it. Do not store invalid state and hope a later process fixes it.

Examples of invalid state:

- A user is both a player and DM for the same event.
- A user is both a player and backup DM through an implicit or accidental transition. Player + Backup DM is allowed only when the user intentionally registers backup DM availability.
- A guest exists without an owning registrant.
- A heroic-only player is counted as seated at a normal-only table. or vis-versa
- An event is published twice as if it were two separate publish operations.
- Assignment status says a player is seated when no compatible capacity exists.

### 4.2 Privacy by default

Operational failures and organizer warnings must not be posted publicly.

Player-facing surfaces may show:

- Event information.
- Signup state.
- Waitlist state.
- Table assignment when released.
- Clear next action.

Organizer-only surfaces may show:

- Assignment warnings.
- Capacity risks.
- Backup DM availability.
- Incompatible table/category pressure.
- Failed job status.
- Internal diagnostics.
- Audit history.

When in doubt, send information privately to organizers or keep it in the web dashboard. Do not put internal state in the public event channel.

### 4.3 One canonical state

Discord and web must read and mutate the same canonical event state. If Discord says an event is published, the web UI must not say it is unpublished.

Every important event property must have one source of truth:

- Event lifecycle status.
- Published state.
- Discord message/channel IDs.
- Registration state.
- Table capacity.
- Assignment lock time.
- Assignment result.
- Waitlist status.
- Attendance status.

### 4.4 Idempotency is required

Repeated actions must be safe.

Required idempotent actions:

- Publish event.
- Run assignment.
- Send assignment notification.
- Rebuild event post.
- Restart bot.
- Restart API.
- Retry failed job.
- Apply migration.
- Run `/ops check`.

Idempotent does not mean silent. If a user tries an action that has already happened, Artemis should explain the current state clearly.

### 4.5 Time must be explicit

Events must preserve and display the intended event timezone. Relative displays are allowed only alongside correct absolute event time handling.

Assignment lock time must be computed from the event start time using the event timezone and stored in canonical state.

If an event starts at 6:00 PM and assignments lock one hour before start, the lock is 5:00 PM in that event's timezone.

### 4.6 Fail closed

If Artemis cannot determine whether a signup, assignment, publish, or notification is valid, it must not perform the action.

Acceptable failure behavior:

- Ephemeral Discord response for the acting user.
- Private organizer warning.
- Web form validation error.
- Logged operational error.
- Retryable job failure.

Unacceptable failure behavior:

- Public stack traces or public failure messages.
- Invalid RSVP records.
- Over-capacity seating.
- Duplicate public event posts.
- Silent job failure.

## 5. Roles and permissions

### 5.1 Product roles

Artemis recognizes these event participation roles:

- Organizer
- DM
- Backup DM
- GM
- Player
- Guest

A Discord user may also have system permissions, but system permission does not automatically make them a participant in an event.

### 5.2 Organizer

Organizers can:

- Create events.
- Edit event details.
- Publish events.
- Cancel events.
- View all registrations.
- View all guests.
- View all DMs and backup DMs.
- View capacity and waitlist pressure.
- View assignment warnings.
- Run or re-run assignment where allowed.
- Release assignments where allowed.
- Manage table and DM configuration.
- Remove invalid or abusive registrations.
- Run operational checks.

Organizer-only warnings must be private to organizers or shown in web organizer UI. They must not be posted to the public player channel.

### 5.3 DM

DMs & GMs can:

- Register as a DM for an event.
- Configure table category support.
- Configure table capacity within allowed bounds.
- Edit their table details before assignment lock unless organizer policy allows later changes.
- Cancel their DM signup before lock where allowed.

A DM cannot simultaneously be a player for the same event.

### 5.4 Backup DM

Backup DMs are distinct from active DMs and players, but Backup DM availability may intentionally coexist with a Player registration.

Backup DMs can:

- Register as available to run an additional table if needed.
- Remain registered as a player while only on backup availability.
- Specify table category support and capacity.
- Be promoted into an active DM/table when assignment logic requires another compatible table.
- Cancel backup availability before lock where allowed.

Backup DM signup must exist as a first-class UI path. It must not be approximated with notes, guest fields, or hidden organizer-only edits.

Default policy:

- A Backup DM should also be registered as a Player unless promoted into an active DM/table.
- When promoted, the user loses active Player seating eligibility for that event.
- Any guests owned by that user remain attached to that user and require organizer-visible handling during assignment.
- Active DM/GM and Backup DM registration eligibility is determined only by organizer-configured application roles/permission gates exposed in the Artemis UI.
- Artemis must not decide, infer, score, rank, recommend, approve, or disqualify DM eligibility based on DM availability, past participation, number of events run, attendance history, or observed patterns.

### 5.5 Player

Players can:

- Register for an event.
- Select supported category preferences.
- Add, edit, or remove guests within configured limits.
- Cancel their signup.
- See whether they are registered, waitlisted, or assigned after assignments are released.
- Edit preferences before lock where allowed.
- players should be allowed to add preferances to play with other players or to avoid other players. These selections MUST be done with discord usernames, we should make this a searchable field using guild profiles.

A player cannot simultaneously be a DM for the same event.

### 5.6 Guest

Guests are attached to a primary registrant. Guests are not free-floating event participants.

Guests must have:

- Owning registrant.
- Event ID.
- Category/preference where relevant.
- Optional nickname/display label.
- Created/updated audit data.
- Guests should be seated with their owning registrant when compatible capacity allows

Guest input must not be an unrestricted text field that can create unlimited guest rows or ambiguous participation records.

Guests should be seated with their owning registrant when compatible capacity allows. Artemis must not violate category compatibility, table capacity, or explicit avoid-player preferences solely to keep a guest with their owner. If separation is unavoidable, the assignment result must flag it for organizer review before release.

## 6. Event lifecycle

### 6.1 Canonical lifecycle states

Artemis events must use clear lifecycle states. The exact enum names may vary, but the behavior must map to this model:

1. Draft
2. Published / Scheduled
3. Registration locked
4. Assignment pending
5. Assignment complete
6. Assignments released
7. In progress
8. Completed
9. Cancelled

An event may skip some internal states if the behavior remains clear, but it must not blur draft, published, assigned, completed, and cancelled.

### 6.2 Draft

Draft events are editable organizer-only records.

Draft events must not create public Discord event posts.

Draft events may be visible in the web dashboard to organizers.

### 6.3 Published / Scheduled

Publishing creates or updates the canonical public event post.

Publishing must:

- Set published state in canonical storage.
- Store Discord channel/message IDs where applicable.
- Make web UI show the event as published.
- Be idempotent.
- Prevent accidental duplicate public posts.
- Expose clear user feedback.

If publishing fails, the failure message must be ephemeral/private. The public channel must not see operational failure output.

### 6.4 Registration locked

Registration lock means normal user-driven changes are restricted.

At or after lock:

- Player signup may be blocked or may go to waitlist depending on event policy.
- DM/table changes require organizer permission.
- Guest changes require organizer policy.
- Assignment logic may run.
- UI must explain what actions are no longer available.

### 6.5 Assignment pending

Assignment pending means the event has reached the point where Artemis should compute seating and waitlist outcomes.

If assignment is pending but not complete, organizer UI must show this clearly.

The bot must not claim users have final table assignments until assignments are computed and released.

### 6.6 Assignment complete

Assignment complete means Artemis has computed a valid assignment result.

Assignment complete does not necessarily mean players have been notified.

Assignment results must preserve:

- Assigned table.
- Waitlisted users.
- Unassigned users and reason.
- Promoted backup DMs.
- Category compatibility decisions.
- Capacity totals.
- Warnings.

### 6.7 Assignments released

Assignments released means player-facing assignment messages are visible or sent.

Release must be idempotent. A retry must not spam duplicate assignment messages.

### 6.8 In progress

Once an event begins, signup/edit/cancel actions should be restricted unless explicitly allowed by organizer policy.

### 6.9 Completed

Completed events should become read-only for normal participants.

Organizers may still update attendance, notes, and audit corrections.

### 6.10 Cancelled

Cancelled events must:

- Stop future scheduled jobs for that event.
- Disable or update public interaction controls.
- Notify affected participants appropriately.
- Preserve audit history.
- Avoid deleting canonical historical records.

## 7. RSVP state machine

### 7.1 RSVP state and Backup DM availability

Artemis must model active event participation separately from Backup DM availability.

Each Discord user may have one active participation state per event:

- None
- Player
- Active DM/GM
- Cancelled

Backup DM availability is a separate event-specific availability record. It may coexist with Player, but it must not coexist with Active DM/GM.

Guest records do not count as the owner's active participation state, but they are subordinate to the owner's registration.

A state transition must be explicit and validated.

### 7.2 Allowed transitions

Allowed default transitions:

| From | To | Requirement |
|---|---|---|
| None | Player | Registration open and capacity policy allows signup/waitlist |
| None | Player + Backup DM availability | Registration open, backup DM signup allowed, and user passes organizer-configured role/permission gate |
| Player | Player + Backup DM availability | Explicit backup DM availability action; user passes organizer-configured role/permission gate |
| Player + Backup DM availability | Player | Cancel backup DM availability only |
| Player | None/Cancelled | Cancellation allowed |
| Active DM/GM | None/Cancelled | Cancellation allowed |
| Player + Backup DM availability | None/Cancelled | Cancellation allowed; policy must define guest handling |
| None | Active DM/GM | Registration open, DM signup allowed, and user passes organizer-configured role/permission gate |
| Player | Active DM/GM | Explicit change-role action; removes active Player seating eligibility and requires handling owned guests |
| Player + Backup DM availability | Active DM/GM | Promotion or explicit change-role action; removes active Player seating eligibility and preserves guest ownership |
| Active DM/GM | Player | Explicit change-role action; removes DM table config |

Rules:

- A user must not be both Active DM/GM and Player for the same event.
- A user may be Player + Backup DM availability only through an explicit backup DM availability action.
- Promotion from Backup DM to Active DM/GM must remove active Player seating eligibility.
- Promotion must preserve guest ownership and expose any guest seating impact to organizers.
- Artemis may enforce organizer-configured Discord role/permission gates for DM and Backup DM signup.
- Artemis must not make DM eligibility rulings based on availability, participation history, attendance history, number of events run, or observed patterns. Active DM/GM and Backup DM eligibility comes only from organizer-configured application roles/permission gates.

### 7.3 Button behavior

The same button press should never produce confusing or contradictory results.

Preferred Discord behavior is state-aware controls:

For users with no registration:

- Sign up as normal player
- Sign up as Heroic player
- Sign up as player + backup DM availability, if authorized
- Sign up as active DM/GM, if authorized

For registered players:

- Cancel player signup
- Edit preferences
- Add/edit guests
- Add backup DM availability, if authorized

For registered players with Backup DM availability:

- Cancel player signup
- Cancel backup DM availability
- Edit preferences
- Add/edit guests
- Edit backup DM availability

For active DMs/GMs:

- Cancel DM/GM signup
- Edit table

If Discord cannot render personalized components per user, then shared components must route to an ephemeral state-aware menu after click.

### 7.4 Cancel behavior

Cancellation must be obvious.

Expected behavior:

- A registered user must have a clear cancel action.
- Re-clicking the same signup role may cancel. The UI text must make that behavior clear or return an ephemeral confirmation.
- Canceling player signup must handle guests according to explicit policy.
- Canceling DM signup must trigger reassessment of capacity and assignment warnings.
- Canceling backup DM availability must update backup availability and warnings.

### 7.5 Preferences

Players must have a path to mark preferences where preferences affect assignment.

At minimum, preferences must support:

- Players they do not wish to be seated with (this should never be exposed to anyone but organizers via the web UI)
- Players they wish to be seated with (this should never be exposed to anyone but organizers via the web UI)
 - these preferances must be based on real user discord profiles not raw names. Use the guild profile not the root user profiles.


The UI must not imply a preference was captured if it was not persisted.

Preference changes after assignment lock require explicit policy.

## 8. Guest registration

### 8.1 Guest model

Guests must be modeled as structured records, not arbitrary lines of user text.

Each guest must include:

- Event ID.
- Owning registrant user ID.
- Guest display label or nickname, if provided.
- Category/preference, if relevant.
- Status: registered, waitlisted, assigned, cancelled, removed, or attended where applicable.
- Audit timestamps.

### 8.2 Guest limits

Guest limits must be enforced in domain logic, not only UI text.

The system must prevent registering more guests than allowed.

If a user attempts to exceed the guest limit:

- Discord response must be ephemeral.
- Web response must be a validation error.
- No partial invalid guest state should be persisted.
- The message should tell the user the current guest count and max allowed.

### 8.3 Guest editing

Users need an obvious path to:

- Add a guest.
- Rename a guest.
- Change guest preference/category where allowed.
- Remove a guest.
- See current guests.
- Understand whether each guest is registered, waitlisted, or assigned.

Organizer web UI must provide guest list editing or removal controls.

### 8.4 Guest capacity

Guests consume event capacity, capacity displays must make that clear.

Capacity UI must not blend unrelated counts in a way that misleads organizers or players.

Preferred display:

- Player registrations
  -show CURRENT user profile name, do not store the name present when the user signs up, this should change if they change their profile name.
- Guest registrations
- Seated participants
- Seat capacity
- Waitlisted participants
- DM/table count

## 9. Table categories and compatibility

### 9.1 Supported categories

The event model currently needs to support at least:

- Normal
- Heroic
- Mixed

Additional categories may be added later, but the compatibility rules must remain explicit and tested.

### 9.2 Compatibility rules

Default compatibility:

| Participant preference/category | Normal table | Heroic table | Mixed table |
|---|---:|---:|---:|
| Normal | Compatible | Not compatible | Compatible |
| Heroic | Not compatible | Compatible | Compatible |
| Any | Compatible | Compatible | Compatible |

A heroic player must not be represented as having a seat at a normal-only table when no heroic or mixed table exists.

A normal player must not be represented as having a seat at a heroic-only table when no normal or mixed table exists.

If policy allows organizer override, the override must be explicit and audited.

### 9.3 Mixed table conversion

If an existing DM has unused capacity but their table category does not match waitlisted demand, Artemis may prompt the organizer or DM to allow a mixed table.

This prompt must be private to organizers/DMs.

The system must not silently convert a table to mixed.

### 9.4 Backup DM promotion

If enough waitlisted players exist to form an additional viable table and a compatible backup DM is available, Artemis should recommend or perform backup DM promotion according to event policy.

Default expected behavior:

- Identify compatible backup DM.
- Create a proposed table.
- Assign compatible waitlisted players if the table meets minimum size.
- Notify organizer privately if promotion requires approval.
- Notify promoted backup DM through an appropriate private channel.
- Do not publicly expose internal shortage logic.

### 9.5 Minimum viable table size

The product expectation from current discussions is that four or more players may justify pulling a backup DM into a new table. If this threshold changes, it must be configured and tested.

Assignment logic must distinguish between:

- Not enough compatible players for a new table.
- Enough players but no compatible backup DM.
- Backup DM available but capacity/category mismatch.
- Existing DM can accept a mixed table if approved.

## 10. Capacity and waitlist logic

### 10.1 Capacity must be category-aware

Capacity is not just a raw seat count. It is compatible seat capacity.

A participant is seated only if:

- A table exists.
- The table has remaining capacity.
- The table category is compatible or explicitly overridden.
- Assignment has actually assigned the participant.

### 10.2 Waitlist requirements

A user must be waitlisted when:

- Total compatible capacity is unavailable.
- Category-compatible capacity is unavailable.
- Assignment is not yet able to seat them.
- Required DM/table approval is pending.
- Event policy places overflow signups on waitlist.

Waitlist state must be visible to organizers and understandable to participants.

### 10.3 Player-facing waitlist messaging

When a user is waitlisted, Artemis should tell them privately or through a clear user-facing response:

- That they are waitlisted.
- Why, in plain language.
- Whether this may change after assignment.
- What action, if any, they can take.

Example acceptable language:

> You're on the waitlist because there are currently no compatible Heroic seats. If a Heroic or Mixed table opens, Artemis will update your status.

### 10.4 Organizer waitlist visibility

Organizer UI must show:

- Waitlisted users.
- Their category/preference.
- Reason they are waitlisted.
- Potential remedies:
  - Add DM.
  - Promote backup DM.
  - Ask DM to allow mixed table.
  - Increase capacity.
  - Change event category policy.

### 10.5 Capacity displays

Avoid ambiguous displays like `10/6 seats` unless the meaning is obvious and labeled.

Preferred organizer display:

```text
Registered: 3 players, 7 guests, 1 DM, 0 backup DMs
Seated capacity: 6 seats across 1 table
Currently seated: 6
Waitlisted: 4
Category pressure: Heroic +4, Normal 0
```

Preferred player display:

```text
Registered players: 3
Guests: 7
Tables: 1
Waitlist active: yes
```

## 11. Assignment logic

### 11.1 Assignment preflight and final lock

Default expectation:

- Artemis runs an assignment preflight twenty-four hours before event start to surface capacity, category, DM, Backup DM, and guest warnings.
- Artemis runs the final assignment lock one hour before event start.
- The final lock time is computed from event start time and event timezone.
- The preflight time and final lock time must be visible to organizers.
- Scheduled jobs must execute reliably in production.

The twenty-four-hour preflight is a warning and readiness pass. It should not lock ordinary participant changes unless event policy explicitly says so.

The one-hour final lock is the default point where Artemis computes or confirms final assignment state and restricts normal participant changes.

If assignment does not run at final lock time, this is a P0 product failure.

### 11.2 Assignment job requirements

The assignment job must:

- Be scheduled when an event is published or when event timing changes.
- Be idempotent.
- Lock the event or use safe concurrency control.
- Avoid duplicate assignment notifications.
- Persist assignment results.
- Persist assignment warnings.
- Produce structured logs.
- Surface failure status to `/ops check` or organizer diagnostics.

### 11.3 Assignment result requirements

Assignment output must explicitly classify every participant as one of:

- Assigned to table.
- Waitlisted.
- Unassigned due to invalid state.
- Cancelled/removed.
- Pending organizer/DM action.

No participant should appear as simply "Unassigned" without a reason in organizer views.

### 11.4 Assignment warnings

Warnings must be private.

Examples:

- No backup DMs available.
- Assignment lock has passed but assignment has not run.
- Category mismatch causing waitlist.
- Not enough compatible capacity.
- DM over capacity.
- Proposed mixed table approval needed.
- Proposed backup DM promotion available.

Warnings must never be posted publicly in the player event channel.

### 11.5 Re-running assignment

Re-running assignment after changes must be controlled.

Default policy:

- Before assignments are released, organizers may re-run assignment.
- After assignments are released, re-running requires explicit confirmation and must preserve an audit trail.
- Re-running must not spam duplicate notifications.
- Re-running must clearly identify changed assignments.

## 12. Notifications and message visibility

### 12.1 Message visibility levels

Every bot message must be intentionally classified:

- Public player-facing channel message.
- Ephemeral Discord interaction response.
- Private DM to a user.
- Organizer-only channel message.
- Web-only organizer diagnostic.
- Application log.
- Event-private thread message.

A message may not be sent until its visibility level is chosen.

### 12.2 Public messages

Public messages may include:

- Event announcement.
- Event details.
- Registration summary suitable for players.
- Assignment release notice, if appropriate.
- Cancellation notice.
- General event reminders.

Public messages must not include:

- Stack traces.
- Internal job errors.
- Organizer warnings.
- Assignment diagnostics.
- Backup DM shortage details unless intentionally player-facing.
- Private participant metadata.

### 12.3 Ephemeral responses

Use ephemeral responses for:

- Signup success/failure.
- Validation errors.
- Already registered messages.
- Role conflict messages.
- Guest limit messages.
- Cancel confirmations.
- Preference edits.
- Permission denials.

Event creation failures must be ephemeral/private, not public.

### 12.4 Organizer private messages

Use organizer-private surfaces for:

- Assignment warnings.
- Capacity risks.
- Backup DM recommendations.
- Failed job notices.
- Publish conflicts.
- Manual intervention prompts.

### 12.5 DMs

Use direct messages carefully. Users may have DMs disabled.

If a DM fails:

- Do not fail the whole operation if the public/event state is otherwise valid.
- Record the notification failure.
- Surface it to organizers where appropriate.
- Provide an alternate public-safe path if needed.

### 12.6 Event-private thread and temporary role

Artemis may create one private thread or private discussion space for the whole event. This is event-wide, not one thread per table by default.

Default behavior:

- Create the temporary event Discord role at event creation.
- Use the role to grant access to the event-private thread or equivalent private space.
- Include registered players, waitlisted players, active DMs/GMs, promoted DMs/GMs, Backup DMs where appropriate, and organizers according to event policy.
- Tag or list users by table assignment inside the event-private thread after assignments are released.
- Do not change the event role solely because a user is reassigned to a different table; reassignment changes the table roster/tagging, not the event role.
- Remove or clean up the temporary event role one week after event end by default.

Failure behavior:

- If role or thread creation fails, log the error with event and guild context.
- Notify organizers immediately through an organizer-private channel or web warning.
- Provide manual remediation instructions so an organizer can create or select a Discord role/group to apply to event participants.
- Retry automatically for failures likely caused by network instability, Discord API instability, or temporary permission propagation delays.
- Do not expose role/thread setup failures publicly to players unless the organizer intentionally sends a player-facing update.

## 13. Discord UI expectations

### 13.1 Event creation

Event creation via Discord command must:

- Validate input.
- Create canonical draft or published event according to command behavior.
- Respond ephemerally to the creator for success/failure.
- Avoid public failure output.
- Provide the event ID to the organizer.
- Provide next actions.

If the command publishes immediately, web UI must show the event as published.

### 13.2 Event post

The public event post should show only player-safe information:

- Event name.
- Date/time.
- Time until event.
- Description or summary.
- Registration counts.
- High-level table/seat availability.
- RSVP'd players and their table role (heroic or normal)
- User action buttons.

It should not show organizer diagnostics.

### 13.3 Signup controls

Discord controls must either be personalized or route to an ephemeral personalized menu.

The user must always be able to determine:

- Am I signed up?
- As what role?
- Are my guests included?
- Am I waitlisted?
- How do I cancel?
- How do I edit preferences?
- How do I add/edit/remove guests?

### 13.4 Error handling

Any Discord interaction error must produce a safe response.

Expected behavior:

- User gets an ephemeral "that did not work" message when possible.
- Error is logged with interaction context.
- Public channel is not polluted.
- No invalid state is persisted.

### 13.5 Interaction expiry

Discord interactions expire. Long work must defer responses correctly.

If work may exceed Discord's response window:

- Defer ephemerally.
- Complete with ephemeral follow-up.
- Do not let the user see "interaction failed" for expected slow paths.

## 14. Web UI expectations

### 14.1 Organizer dashboard

The web UI must let organizers understand the actual event state at a glance.

Required event dashboard information:

- Event status.
- Published state.
- Discord post/channel link or status. Channel ID and human readable name. 
- Start/end time and timezone.
- Assignment lock time.
- Assignment status.
- Players.
- Guests.
- DMs.
- Backup DMs.
- Table capacity.
- Category pressure.
- Waitlist.
- Warnings.
- Audit-sensitive recent changes.

### 14.2 DM/table visibility

The web UI must show existing DMs and table details:

- DM name.
- Table category.
- Min/max capacity where relevant.
- Current assigned count.
- Over/under capacity status.
- Whether mixed table is allowed.
- Whether the DM was promoted from backup.
- Edit controls where organizer policy allows.

The web UI may show DM history and participation context for organizer awareness only:

- How many events the DM has run.
- Whether the DM has run at least 5 events in the last 6 months.
- The DM's observed event participation history, such as Thursday events vs Saturday events.

These signals are display-only context. Artemis must not use them to decide, infer, score, rank, recommend, approve, reject, warn about, or disqualify DM/GM or Backup DM eligibility. Eligibility to register as DM/GM or Backup DM is determined only by organizer-configured application roles/permission gates exposed in the Artemis UI.

Lack of web visibility into DMs and capacity is not acceptable for organizer operations.

### 14.3 Guest management

The web UI must provide a way to inspect and edit guest lists.

Required controls:

- View guests by owning registrant.
- Add guest for registrant where allowed.
- Rename guest.
- Remove guest.
- Change guest category/preference where allowed.
- See guest status.
- Enforce guest limits.

### 14.4 Publish controls

The web UI must not allow double publish.

If an event is already published:

- Show "Published".
- Show link/status for the Discord post.
- Disable the primary publish action or make it "Sync/Rebuild post".
- If rebuilding, explain that it updates the existing post rather than creating a new one.

### 14.5 Assignment controls

The web UI must show:

- Whether assignment is pending, complete, failed, or released.
- Why assignment failed or produced warnings.
- What action the organizer can take.
- Whether a rerun is safe.
- Whether assignment release has occurred.

### 14.6 Completed event controls

After event end, web UI should support:

- Attendance marking.
- Organizer notes.
- Audit review.
- Read-only registration history.
- Follow-up corrections where allowed.

### 14.7 Event editing and signup option management

The web UI must allow organizers to manage event configuration without relying on Discord command-menu flows.

Required event editing controls:

- Title.
- Description.
- Start and end time.
- Duration.
- Recurrence or series behavior where supported.
- Event mentions.
- Event restrictions.
- Signup close time.
- Reminders.
- Event image where supported.
- Duplicate event where supported.

Required signup option controls:

- View configured signup options.
- Add signup option where policy allows.
- Remove signup option where safe.
- Modify signup option.
- Configure option capacity.
- Configure option reminders.
- Configure option restrictions.
- Configure application role/permission requirements for active DM/GM and Backup DM signup.
- Validate capacity values before saving.
- Prevent removing or reducing an option in a way that strands existing registrations without explicit organizer confirmation.

When editing an event that belongs to a series, Artemis must ask whether the change applies only to this event or to future events in the series. If series editing is not implemented, the UI must not imply that it is.

### 14.8 Multiple signup policy

Artemis must not implement generic "multiple signups" as arbitrary duplicate RSVP rows.

Multiple participation states are allowed only where explicitly modeled, such as:

- Player + Backup DM availability before promotion.
- Player + structured guest records.
- Organizer-managed corrections with audit history.

The web UI must show these cases using explicit labels, not a vague "multiple signups enabled" toggle.

## 15. API expectations

The API must enforce all domain rules independently of the client.

No Discord handler or web route may be the only enforcement point for:

- RSVP exclusivity.
- Guest limits.
- Category compatibility.
- Publish idempotency.
- Assignment idempotency.
- Event lifecycle transitions.
- Permissions.
- Notification visibility.

API responses should return structured errors that clients can safely render.

Expected error fields:

- Machine-readable code.
- Human-safe message.
- Field/path where applicable.
- Current canonical state where useful.
- Whether retry is allowed.

## 16. Database and migration expectations

Schema must support the product model without relying on overloaded text fields.

Required concepts should exist explicitly:

- Event.
- Event lifecycle status.
- Published state and Discord message metadata.
- User/participant registration.
- RSVP role.
- Guest records.
- Preferences/category.
- DM table configuration.
- Backup DM availability.
- Assignment result.
- Assignment warning.
- Notification delivery record.
- Event temporary Discord role/thread metadata.
- Audit event.
- Job/schedule metadata where needed.

Migrations must be safe under the production deploy script:

- Forward-only unless explicitly documented.
- Compatible with the new service version.
- No manual production DB edits as part of normal deploy.
- Backfills must be idempotent.
- Destructive changes require explicit migration notes and rollback thinking.

## 17. Jobs and scheduling

Production uses service restarts and PostgreSQL-backed infrastructure. Scheduled work must be visible and reliable.

Required jobs:

- Assignment lock/assignment run.
- Event reminder where applicable.
- Assignment release where applicable.
- Temporary event role/thread cleanup jobs where applicable.
- Cleanup/sync jobs where applicable.

Each job must have:

- Stable job name.
- Idempotent handler.
- Structured logging.
- Error capture.
- Retry policy.
- Observability in `/ops check` or equivalent diagnostics.

Assignment failing to run one hour before an event must be detectable without reading raw logs.

## 18. `/ops check`

`/ops check` is the required post-deploy smoke test.

It should verify at minimum:

- Bot is online.
- API is reachable.
- Web is reachable or web health is known.
- Database is reachable.
- Required environment variables are present.
- Scheduled job system is reachable.
- Assignment worker is registered/running.
- Current service versions or commit hash are visible.
- Recent job failures are visible.
- Basic Discord permissions are valid.
- Public/private message destinations are configured.

`/ops check` must be safe to run repeatedly.

## 19. Logging and audit

### 19.1 Application logs

Logs must be useful for production debugging.

Log these events:

- Event created/updated/published/cancelled.
- RSVP created/changed/cancelled.
- Guest added/edited/removed.
- DM table changed.
- Backup DM registered/promoted/cancelled.
- Assignment scheduled/started/completed/failed.
- Notification sent/failed/skipped.
- Publish attempted/succeeded/skipped/failed.
- Permission denied.
- Validation rejected.

Logs must include stable IDs, not just display names.

### 19.2 Audit trail

User-meaningful state changes must have audit records.

Audit records should answer:

- Who made the change?
- What changed?
- When did it change?
- Which event did it affect?
- Was it Discord, web, system job, or admin action?
- What was the previous state where relevant?

### 19.3 Public names

Display names may change. Regularly poll display names for changes.

Store Discord IDs and use display names only for display snapshots.

## 20. Testing expectations

No feature touching event operations is complete without tests.

### 20.1 Domain tests

Required domain test coverage:

- RSVP exclusivity.
- DM cannot sign up as player.
- Player + Backup DM availability is allowed only through an explicit Backup DM availability action.
- Promoted Backup DM loses active Player seating eligibility.
- Cancel RSVP.
- Guest add/edit/remove.
- Guest limit enforcement.
- Category compatibility.
- Heroic player waitlisted when only normal tables exist.
- Normal player waitlisted when only heroic tables exist.
- Mixed table compatibility.
- Backup DM promotion threshold.
- Capacity display calculations.
- Assignment result classification.
- Assignment idempotency.
- Publish idempotency.
- Event lifecycle transition validation.

### 20.2 API tests

Required API test coverage:

- Web and Discord paths call the same domain rules.
- Invalid actions return safe structured errors.
- Publish state persists correctly.
- Guest limits cannot be bypassed.
- Assignment status is retrievable.
- Organizer-only data requires organizer permission.

### 20.3 Bot tests

Required bot test coverage:

- Event creation failure is ephemeral/private.
- Signup buttons produce correct state-aware responses.
- Role conflict produces ephemeral error.
- Guest limit produces ephemeral error.
- Organizer warning is not public.
- Interaction deferral prevents avoidable "interaction failed" responses.
- Duplicate publish is prevented.
- Notification retries do not spam.

### 20.4 Web tests

Required web test coverage:

- Published events show as published.
- Already-published events cannot be double-published.
- DMs and capacity are visible.
- Guest list can be edited.
- Waitlist is visible.
- Assignment warnings are private/organizer-only.
- Completed events become appropriately restricted.

### 20.5 Production smoke tests

Before considering a deploy acceptable:

- Build succeeds.
- Migrations succeed.
- API health is healthy.
- Web health is healthy.
- Bot starts successfully.
- `/ops check` passes.
- A test event can be created without public failure leakage.
- Publish state matches between Discord and web.
- RSVP role exclusivity works.
- Assignment job registration is visible.

## 21. Manual QA scenarios

Use these scenarios as a minimum manual test matrix.

### 21.1 Basic event

1. Organizer creates event.
2. Event is published.
3. Web shows published.
4. Player signs up.
5. Player cancels.
6. Player signs up again.
7. Event post reflects correct counts.

Expected outcome: no public errors, no duplicate publish, no stale web state.

### 21.2 DM exclusivity

1. User signs up as DM.
2. Same user attempts player signup.

Expected outcome: player signup is blocked or converted only through explicit change-role flow. No dual registration.

### 21.3 Backup DM flow

1. User signs up as player.
2. Same user adds Backup DM availability through an explicit Backup DM action.
3. Organizer views the Backup DM list.
4. Assignment promotes the Backup DM into an active DM/table when needed.

Expected outcome: Backup DM is first-class and visible. A user may intentionally hold Player + Backup DM availability before promotion. Upon promotion, Artemis removes active Player seating eligibility while preserving guest ownership and audit history.

### 21.4 Guest limit

1. Player signs up.
2. Player adds guests up to limit.
3. Player attempts one more guest.

Expected outcome: extra guest is rejected with ephemeral/web validation. No invalid guest row exists.

### 21.5 Heroic with only normal table

1. Create normal-only DM table.
2. Register heroic player.
3. Run assignment.

Expected outcome: heroic player is waitlisted, not counted as seated. Organizer gets private category mismatch warning.

### 21.6 Mixed table approval

1. Create normal-only table with open seats.
2. Register heroic overflow.
3. Run assignment.

Expected outcome: Artemis prompts privately for mixed table approval where policy allows. It does not silently seat heroic at normal-only table.

### 21.7 Backup DM promotion

1. Register enough compatible waitlisted players to form another table.
2. Register compatible backup DM.
3. Run assignment.

Expected outcome: Artemis proposes or performs backup DM promotion according to policy and assigns a valid table.

### 21.8 Assignment lock

1. Create event with lock one hour before start.
2. Confirm assignment job is scheduled.
3. Reach lock time or trigger job in test.
4. Inspect assignment status.

Expected outcome: assignment runs once, persists result, and exposes warnings privately.

### 21.9 Publish idempotency

1. Publish from Discord command.
2. Open web UI.
3. Attempt publish from web.

Expected outcome: web shows already published and does not create duplicate public post.

### 21.10 Event end

1. Let event pass end time.
2. Try player signup/cancel/edit.
3. Inspect web status.
4. Mark attendance.

Expected outcome: participant changes are restricted; organizer completion tools remain available.

## 22. Severity definitions

### P0

A P0 blocks production release or requires immediate production mitigation.

Examples:

- Assignment does not run at lock time.
- Public channel receives internal error or organizer warning.
- Invalid seating/capacity result.
- RSVP role exclusivity violation.
- Guest limit bypass.
- Duplicate publish creates duplicate public event posts.
- API/web health failure after deploy.
- Migration failure.

### P1

A P1 blocks a complete v1 experience but may not require immediate rollback if mitigated.

Examples:

- Missing backup DM signup.
- Missing cancel RSVP UI.
- Missing guest edit UI.
- Web lacks DM/capacity visibility.
- Waitlist messaging incomplete.
- Assignment warnings not clear enough.
- Preferences missing where assignment depends on them.

### P2

A P2 is polish, clarity, or efficiency that does not break trust or event correctness.

Examples:

- Improved copy.
- Better visual layout.
- Additional filters.
- Better summary formatting.
- Convenience shortcuts.

## 23. Definition of done

A change is done only when all relevant items are true:

- Domain rules are enforced in shared logic.
- API rejects invalid state.
- Discord UI gives safe, clear feedback.
- Web UI reflects canonical state.
- Public/private message boundary is respected.
- Tests cover expected and invalid paths.
- Logs/audit capture important transitions.
- Migrations are included and safe.
- `/ops check` remains valid.
- Manual QA scenario is updated if behavior changes.

"Works on the happy path" is not done.

## 24. Guidance for coding agents and contributors

Before changing Artemis:

1. Read this file.
2. Identify which lifecycle, RSVP, assignment, capacity, notification, or deployment rule is affected.
3. Add or update tests first for domain behavior.
4. Keep rules in shared services.
5. Avoid duplicating business logic between Discord and web.
6. Prefer explicit state transitions over implicit side effects.
7. Prefer private/ephemeral failure messages.
8. Make jobs idempotent.
9. Make publish and assignment idempotent.
10. Update this file if product expectations intentionally change.

If a requested implementation conflicts with this file, stop and flag the conflict instead of coding around it.

## 25. Current known gaps to close

The following gaps are known from manual testing and should be treated as active remediation targets:

- Event creation failure is visible publicly instead of ephemeral/private.
- Backup DM signup option is missing.
- DM can also sign up as player.
- Organizer warnings are posted publicly.
- Player preference options are missing.
- Heroic players can appear seated despite no heroic/mixed table capacity.
- Web UI can show an event as unpublished after Discord publish.
- Web UI lacks visibility into DMs, their capacity, and table details.
- Guest list editing is unclear or unavailable.
- Cancel signup flow is unclear or broken.
- Guest registration can exceed allowed count.
- Guest registration relies too much on open text.
- Assignment did not run one hour before event.
- Waitlist messages/alerts are missing or insufficient.
- Capacity display can show misleading values such as over-capacity without clear waitlist/category explanation.
- UI allows double publish from web.

These are not isolated bugs. They indicate that RSVP state, capacity/category assignment, notification privacy, and cross-surface canonical state need hardening.

## 26. Preferred remediation order

Fix in this order:

1. Public/private message boundary.
2. RSVP role exclusivity and cancel behavior.
3. Structured guest model and guest limits.
4. Backup DM first-class signup.
5. Category-aware capacity and waitlist logic.
6. Assignment scheduling and idempotency.
7. Publish idempotency and web/Discord state sync.
8. Web organizer visibility for DMs, guests, capacity, waitlist, and warnings.
9. Player preferences.
10. UX polish.

This order protects trust and data correctness before convenience.

## 27. Acceptable v1 outcome

A v1 Artemis release is acceptable when:

- Organizers can create and publish events without duplicate posts or public failures.
- Players can sign up, cancel, manage guests, and understand their status.
- DMs and backup DMs have distinct, exclusive flows.
- Guest limits are enforced.
- Category preferences affect assignment correctly.
- Incompatible players are waitlisted rather than falsely seated.
- Assignment runs at the configured lock time.
- Assignment results are persisted and visible to organizers.
- Player-facing assignment/waitlist messaging is clear.
- Organizer warnings are private.
- Web and Discord show the same canonical event state.
- Deployment follows the production script successfully.
- `/ops check` passes after deploy.
- Manual QA scenarios in this file pass.

If these conditions are not met, the project may still be useful for internal testing, but it should not be described as production-ready.
