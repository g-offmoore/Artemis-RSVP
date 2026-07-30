# Product Feedback TODOs

This file tracks remaining areas identified from the product feedback that
require future updates. These are intentionally marked as TODO only; any mention
of current behavior is included only to scope the remaining gap.

## Expectation Reset

Artemis is currently operationally capable but not product-complete. The app can
manage events and assignments, but it does not yet fully automate the recurring
campaign and dynamic-capacity workflow that motivated the product.

## Core Completion

- TODO: Alternating recurrence and parity for every biweekly series creation
  path.
- TODO: Series-level inherited configuration beyond current copied
  signup-option/event-type settings.
- TODO: Registration-window enforcement and generated-occurrence deadline
  behavior.
- TODO: Define and implement the participant status model across registered,
  guaranteed, assigned, waitlisted, cancelled, and removed states.
- TODO: Persistent campaigns with weekly RSVP requirements.
- TODO: Per-system DM capacity tied to occurrence signup.
- TODO: Ensure multi-system DM offers contribute capacity only once and resolve
  to a single active table commitment.
- TODO: Explicit assignment priority rules.
- TODO: Automatic reassignment and waitlist promotion.
- TODO: Handle occurrence cancellation, rescheduling, and eligibility changes
  without silently retaining invalid assignments.
- TODO: Notify users of every committed, user-visible status change, including
  guarantee, waitlist, assignment, reassignment, displacement, cancellation, and
  removal, while suppressing intermediate recalculation states.
- TODO: Scoped delegated administration.
- TODO: Discord role selectors and remaining channel/role selectors outside the
  unified event creation flow.
- TODO: Campaign/table preference priority.

## Configuration Maturity

- TODO: Arbitrary participation types beyond labels mapped onto built-in
  behaviors.
- TODO: Custom RSVP forms beyond the current signup-option toggles.
- TODO: Notification previews.
- TODO: Fully configurable message timing and destinations.
- TODO: Prefer-player and seating-group optimization.

## Lower Priority / Deferred

- TODO: Treat binary event-image upload as lower priority than the
  capacity-and-assignment lifecycle.
- TODO: Treat Meetup integration as lower priority and outside the core Artemis
  workflow for now.
- TODO: Treat the feedback workflow as lower priority than recurrence,
  campaigns, dynamic capacity, and assignment automation.
- TODO: Keep seating groups and prefer-player behavior on the assignment-quality
  backlog, behind DM capacity, campaign continuity, and table preference.

## Recurrence And Series

- TODO: Complete alternating program support and verify every dashboard and
  Discord series creation path exposes the existing every-other-week recurrence
  capability.
- TODO: Expand series-carried configuration beyond the current generated-event
  copy of signup options to include independent channels, roles, eligibility
  rules, notification rules, and assignment defaults.
- TODO: Automatically generate and publish the correct next occurrence.
- TODO: Add a post-event prompt that directs users to the newly opened RSVP.

## Registration Windows

- TODO: Apply series signup-open and signup-close offsets when generating
  occurrences, instead of relying only on one-off event fields.
- TODO: Enforce registration open and close windows across RSVP creation, RSVP
  edits, cancellations, guest changes, and DM/table signup.
- TODO: Support separate player and DM registration deadlines if product rules
  require them.
- TODO: Define and implement late RSVP behavior, including direct waitlist,
  organizer approval, or hard rejection.
- TODO: Preserve or intentionally reset signup timestamps when users edit an
  RSVP, based on the final priority/tie-breaking rules.

## Participant Status Model

- TODO: Define the canonical participant states, including registered,
  guaranteed, assigned, waitlisted, cancelled, and removed.
- TODO: Decide whether guaranteed-but-unassigned is a permitted persistent
  state or only a transient assignment-engine concept.
- TODO: Define every allowed transition between participant states and which
  transitions are user-driven, organizer-driven, or system-driven.
- TODO: Ensure Discord responses, dashboard views, audit logs, and notifications
  use the same status vocabulary.
- TODO: Decide whether guests inherit the primary RSVP status or require their
  own explicit participant status.

## Withdrawal And Re-entry

- TODO: Decide whether a cancelled player may RSVP again for the same
  occurrence.
- TODO: Decide whether re-entry restores the original signup timestamp or
  creates a new timestamp for assignment priority.
- TODO: Define whether campaign priority survives cancellation and re-entry.
- TODO: Define whether administrative restoration differs from user
  re-registration.
- TODO: Notify affected users when withdrawal or re-entry changes guarantee,
  waitlist, assignment, or campaign status.

## Occurrence Cancellation And Rescheduling

- TODO: Define what happens to RSVPs, guests, tables, assignments, waitlist
  positions, and attendance records when an occurrence is cancelled.
- TODO: Decide whether rescheduled events preserve existing RSVPs and
  assignments.
- TODO: Decide whether users must reconfirm after a material time, venue,
  channel, GM, or program change.
- TODO: Define how campaign attendance and expected-session counts handle
  cancelled or skipped weeks.
- TODO: Define notifications for cancellation, rescheduling, reopening, and
  reconfirmation requests.

## Campaigns And Persistent Tables

- TODO: Add persistent campaign / mini-arc entities with name, GM, system,
  category or level, description, expected sessions, capacity, status, and
  preferred or returning players.
- TODO: Allow campaign membership or interest to carry across weekly RSVP
  occurrences and affect assignment priority.
- TODO: Require a fresh RSVP for every generated event occurrence, including
  campaign and mini-arc participants.
- TODO: Prevent campaign membership from automatically reserving a seat without
  a current-occurrence RSVP.
- TODO: Decide whether event tables are generated from persistent campaigns or
  linked to them per occurrence.

## Configurable Event Programs

- TODO: Replace fixed participation role assumptions with configurable
  per-series participation types such as player, GM, backup GM, apprentice GM,
  campaign participant, observer, and event-specific custom roles.
- TODO: Replace hard-coded D&D Normal/Heroic/Mixed categories with configurable
  category sets per game system or event series.
- TODO: Add configurable RSVP questions and modals per event or series beyond
  the current built-in signup-option toggles.

## Admin UX And Permissions

- TODO: Replace remaining raw Discord snowflake entry with dashboard selectors
  for known guild channels and roles, building on the unified event creation
  guild/channel picker.
- TODO: Add scoped delegated management beyond guild-wide staff/admin access,
  including owner, administrator, event manager, series/table manager,
  assignment-only, attendance-only, and settings-management scopes.

## Eligibility Changes

- TODO: Define behavior when a user loses a required Discord role after
  registering.
- TODO: Define behavior when eligibility rules change after players have
  registered.
- TODO: Decide whether ineligible users are automatically removed, waitlisted,
  flagged for review, or grandfathered.
- TODO: Notify affected users when eligibility changes invalidate their
  registration, guarantee, waitlist position, or assignment.
- TODO: Ensure eligibility changes for sensitive or restricted programs do not
  expose private role, identity, preference, or moderation information.

## Assignment, Capacity, And Preferences

- TODO: Expand preference priority beyond prefer-DM to include specific GM,
  campaign, persistent table, game system, play category, and preferred players.
- TODO: Ensure a compatible player with an explicit matching preference is
  prioritized above an otherwise compatible player with no preference.
- TODO: Derive capacity from the DM's current-occurrence signup, using their
  configured per-system defaults while allowing authorized per-occurrence
  overrides for the chosen system, category, and table.
- TODO: Support per-system soft/hard capacity, such as different limits for
  D&D and Daggerheart.
- TODO: Automatically rerun assignments when a DM signs up or withdraws, a
  player cancels, or capacity changes.
- TODO: Promote waitlisted players automatically and notify promoted, displaced,
  or changed-assignment users.
- TODO: Update Discord event displays after automatic assignment changes.
- TODO: Explain assignment and waitlist decisions in the dashboard.
- TODO: Define which preferences are visible to GMs, series managers, and guild
  administrators.
- TODO: Prevent player-facing explanations from revealing another player's
  preferences, priority, eligibility, attendance history, or restricted-program
  status.
- TODO: Define whether avoid-player and avoid-GM preferences are visible only to
  restricted staff.
- TODO: Ensure Discord roster publication does not expose private preference or
  eligibility information.

## DM Offers And Table Lifecycle

- TODO: Decide whether every eligible DM signup immediately contributes capacity
  or whether some series require organizer approval before activation.
- TODO: Define whether newly registered ambassadors can host immediately.
- TODO: Decide whether a backup DM promoted to primary requires confirmation.
- TODO: Allow a DM to be removed from an occurrence without deactivating their
  ambassador profile.
- TODO: Define whether a DM signup expresses one committed table or multiple
  ranked offers.
- TODO: Define how Artemis chooses between systems or categories when a DM
  offers several options.
- TODO: Prevent one DM's alternative offers from contributing duplicate
  capacity.
- TODO: Define whether organizers may select which proposed table becomes
  active.
- TODO: Decide whether a DM signup automatically creates a draft table.
- TODO: Decide whether organizers must approve ad-hoc occurrence tables.
- TODO: Define whether a table's system/category comes from the DM signup or
  organizer configuration.
- TODO: Decide whether table capacity can differ from the DM's occurrence
  capacity.
- TODO: Decide whether a table can exist without a named DM.
- TODO: Decide whether an active DM can be reassigned between tables.

## Notifications And Staffing

- TODO: Add earlier staffing shortage alerts, roughly two or three days ahead,
  with actionable capacity numbers.
- TODO: Make registration open time, shortage alerts, message destinations,
  role mentions, affected-user DMs, final assignment publication, and next RSVP
  announcement configurable rather than fixed schedules.
- TODO: Notify only committed user-visible status changes, not internal draft
  recalculation churn.
- TODO: Notify users when they are removed from a waitlist, table, campaign, or
  event, not only when promoted or reassigned.
- TODO: Prevent duplicate or contradictory notifications during rapid
  recalculations.
- TODO: Allow organizers to preview notification recipients and content.
- TODO: Add retry and visible failure handling for user-facing notification
  delivery.

## Discord-First Workflow

- TODO: Confirm which GM actions must be available through Discord versus
  dashboard-only.
- TODO: Add Discord flows for proposing campaigns or tables if GMs should
  initiate them without administrator intervention.
- TODO: Define whether administrative slash commands remain supported
  interfaces, emergency tools, or are superseded by dashboard workflows.
- TODO: Ensure Discord responses clearly distinguish registered, guaranteed,
  assigned, and waitlisted states.

## Discord Failure Recovery

- TODO: Define the database as the authoritative state when Discord publication,
  message edit, thread creation, notification, or role-sync updates fail.
- TODO: Surface Discord publication and role-sync failures in the dashboard.
- TODO: Allow authorized users to retry failed Discord operations.
- TODO: Prevent failed Discord updates from rolling back valid RSVP,
  assignment, attendance, or campaign state.
- TODO: Reconcile message, thread, role, and notification state after bot
  downtime.

## Audit And Overrides

- TODO: Record the reason for automatic assignment changes and waitlist
  decisions.
- TODO: Store each committed assignment run as a revision with inputs, rules,
  results, and recalculation reason.
- TODO: Allow organizers to compare the current draft assignment against the
  last committed revision.
- TODO: Generate user notifications from the difference between committed
  assignment revisions.
- TODO: Allow rollback to a prior committed assignment revision where
  operationally safe.
- TODO: Record who made each manual override and whether it is protected from
  recalculation.
- TODO: Add an explicit way to release or expire a manual assignment lock.
- TODO: Warn administrators before an override displaces or waitlists another
  player.

## Attendance And No-Shows

- TODO: Decide whether attendance history affects campaign priority.
- TODO: Decide whether repeated no-shows reduce RSVP priority or require
  organizer approval.
- TODO: Decide whether no-show policies are configurable per guild or series.
- TODO: Define whether excused cancellations differ from no-shows.
- TODO: Decide whether Artemis only reports attendance history instead of
  enforcing attendance-based penalties.

## Feedback

- TODO: Implement the end-to-end feedback request workflow; current support is
  mostly schema/settings-level.

## Product Decisions

These require explicit product decisions before implementation so behavior is
not inferred from developer assumptions.

### Decisions To Resolve First

- TODO: Soft and hard capacity semantics.
- TODO: Assignment priority and tie-breaking.
- TODO: Campaign membership and returning-player priority.
- TODO: Draft versus published recalculation.
- TODO: Series inheritance and occurrence overrides not covered by the current
  event-type copy-at-generation behavior.
- TODO: Registration closing and editing rules.
- TODO: Participant status model and whether guaranteed-but-unassigned is a
  persistent state.
- TODO: DM offer, approval, and capacity-counting semantics.
- TODO: Occurrence cancellation, rescheduling, and post-RSVP eligibility-change
  behavior.

### Series Configuration Behavior

- TODO: Document and harden the current generated-occurrence copy behavior for
  event-type/signup settings, then decide whether other series settings copy at
  generation time or reference the series dynamically.
- TODO: Decide whether edits to channels, roles, eligibility, notifications,
  assignment defaults, title, description, or timing update already-generated
  events.
- TODO: Define which series settings may be overridden per occurrence.
- TODO: Define recovery behavior when a configured Discord channel or role is
  deleted.

### Registration Rules

- TODO: Decide whether users may RSVP for multiple different event series during
  the same week.
- TODO: Define whether RSVP preferences may be edited after submission and until
  what deadline.
- TODO: Define registration closing time and reopening behavior.
- TODO: Define separate player and DM registration deadlines.
- TODO: Decide whether late RSVPs go directly to the waitlist or require
  organizer approval.
- TODO: Decide whether cancellation remains available after registration closes.
- TODO: Decide whether editing an RSVP preserves its original signup timestamp.

### Soft Versus Hard Capacity

- TODO: Define exact soft-cap behavior: preferred target, guaranteed capacity,
  or threshold for requesting another GM.
- TODO: Define whether all assignments up to hard capacity are guaranteed.
- TODO: Define how assignments above soft capacity are presented to organizers
  and players.
- TODO: Define what happens when a DM reduces capacity after players have
  already been assigned.
- TODO: Confirm the likely baseline interpretation: soft capacity is the
  preferred table size, hard capacity is the absolute maximum, assignments above
  soft capacity remain guaranteed, and waitlist begins only after total hard
  capacity is exceeded.

### Capacity Ownership

- TODO: Decide whether DMs manage their own per-system defaults or staff manage
  those defaults.
- TODO: Decide whether DMs may override their capacities during occurrence
  signup.
- TODO: Decide whether an occurrence override may exceed the profile hard cap.
- TODO: Define whether backup or apprentice DMs contribute capacity before
  activation.
- TODO: Decide whether one DM may run multiple tables in the same occurrence.

### Participation Type Semantics

- TODO: Decide whether configurable participation types are labels mapped onto
  built-in behaviors or fully configurable role behavior controlling capacity,
  assignments, eligibility, attendance, and notifications.
- TODO: Treat fully configurable role behavior as a much larger scope than
  configurable labels.

### Assignment Priority

- TODO: Establish an explicit deterministic priority order between locked manual
  assignments, returning campaign members, explicit GM/campaign preferences,
  party and preferred-player grouping, RSVP order, no-preference players, and
  guests.
- TODO: Confirm whether the likely priority order is locked manual assignments,
  weekly RSVP by existing campaign participants, explicit campaign or GM
  preference, party/preferred-player grouping, no-preference compatible players,
  overflow to hard capacity, then waitlist.
- TODO: Define tie-breaking rules when multiple players have equal priority.
- TODO: Define whether returning campaign players outrank new players explicitly
  requesting the campaign.
- TODO: Define guest assignment and waitlist priority.

### Automatic Versus Organizer-Approved Assignment

- TODO: Decide whether automatic recalculation produces draft assignments or
  immediately publishes changes.
- TODO: Add organizer review or approval controls if automatic changes should
  not publish immediately.
- TODO: Decide whether the expected model is continuous draft recalculation with
  organizer review and a scheduled final lock.
- TODO: Define when assignments become stable or locked and which changes may
  still trigger recalculation afterward.
- TODO: Ensure automatic recalculation preserves protected manual assignments.
- TODO: Define recovery behavior when a late DM withdrawal makes existing
  assignments impossible.

### Assignment Stability Before Lock

- TODO: Decide whether Artemis may move already-assigned players simply to
  improve the overall allocation before lock.
- TODO: Decide whether a previously published assignment receives stability
  priority over a mathematically better new allocation.
- TODO: Decide whether a preference edit may displace another assigned player.
- TODO: Confirm users are notified only for committed assignment changes, not
  draft recalculation churn.

### Campaign Lifecycle

- TODO: Define campaign completion, cancellation, GM replacement, and missed-week
  handling.
- TODO: Define whether campaign membership is formal, preference-based, or
  inferred from previous assignments.
- TODO: Define how a player leaves a campaign or loses recurring priority.
- TODO: Define how substitute players are selected for a single occurrence.
- TODO: Decide whether campaigns can span multiple event series or only one
  series.

### Discord Administration

- TODO: Decide whether `/event create`, `/event cancel`, `/event assign`, and
  `/event table` are fully supported secondary administration tools, emergency
  shortcuts, or temporary interfaces to be replaced by dashboard workflows.

### Notifications

- TODO: Define notification behavior when a capacity loss displaces an assigned
  player.
