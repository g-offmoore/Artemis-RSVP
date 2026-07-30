# Product Feedback TODOs

This file tracks areas identified from the product feedback that require future
updates. These are intentionally marked as TODO only; no behavior is implemented
as part of this pass.

## Expectation Reset

Artemis is currently operationally capable but not product-complete. The app can
manage events and assignments, but it does not yet fully automate the recurring
campaign and dynamic-capacity workflow that motivated the product.

## Core Completion

- TODO: Biweekly and alternating recurrence.
- TODO: Series-level inherited configuration.
- TODO: Persistent campaigns with weekly RSVP requirements.
- TODO: Per-system DM capacity tied to occurrence signup.
- TODO: Explicit assignment priority rules.
- TODO: Automatic reassignment and waitlist promotion.
- TODO: Notify users of every committed, user-visible status change, including
  guarantee, waitlist, assignment, reassignment, displacement, cancellation, and
  removal, while suppressing intermediate recalculation states.
- TODO: Scoped delegated administration.
- TODO: Discord channel and role selectors.
- TODO: Campaign/table preference priority.

## Configuration Maturity

- TODO: Arbitrary participation types.
- TODO: Custom RSVP forms.
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

- TODO: Add every-other-week recurrence and alternating program support.
- TODO: Let series carry independent channels, roles, eligibility rules,
  notification rules, and assignment defaults into generated events.
- TODO: Automatically generate and publish the correct next occurrence.
- TODO: Add a post-event prompt that directs users to the newly opened RSVP.

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
- TODO: Add configurable RSVP questions and modals per event or series.

## Admin UX And Permissions

- TODO: Replace raw Discord snowflake entry with dashboard selectors for known
  guild channels and roles.
- TODO: Add scoped delegated management beyond guild-wide staff/admin access,
  including owner, administrator, event manager, series/table manager,
  assignment-only, attendance-only, and settings-management scopes.

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

## Audit And Overrides

- TODO: Record the reason for automatic assignment changes and waitlist
  decisions.
- TODO: Record who made each manual override and whether it is protected from
  recalculation.
- TODO: Add an explicit way to release or expire a manual assignment lock.
- TODO: Warn administrators before an override displaces or waitlists another
  player.

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
- TODO: Series inheritance and occurrence overrides.
- TODO: Registration closing and editing rules.

### Series Configuration Behavior

- TODO: Decide whether generated occurrences copy series settings at generation
  time or reference series settings dynamically.
- TODO: Decide whether series edits update already-generated events.
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
