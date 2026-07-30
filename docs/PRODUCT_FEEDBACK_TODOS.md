# Product Feedback Status And TODOs

This file tracks the remaining product gaps after the current `master` state.
Implemented items should not stay here as active TODOs. When behavior is only
partially implemented, the TODO names the remaining product or reliability work.
Repository status, remediation order, and branch-specific gap tracking belong
here rather than in `rules.md`, which should remain the stable product contract.

Current baseline: `master` at `5c64de9`.

## Current Implemented Baseline

- Event creation, publish, edit, cancel, RSVP, guests, table signup, backup DM,
  preferences, assignment, attendance, audit logs, and dashboard operations exist.
- Cancelled events reject key player-facing mutations and published Discord
  posts suppress signup controls.
- Discord RSVP, backup DM, and table signup now pass member role IDs into API
  eligibility checks.
- Registration windows are enforced for RSVP creation, guest edits, and table
  signup.
- Series generation supports weekly and biweekly recurrence, clones event-type
  signup settings per occurrence, propagates signup windows into generated
  events, and auto-generates the next occurrence when a live series would
  otherwise have only one upcoming event.
- Event and series signup-option toggles exist; `allowsGuests` is enforced by
  the API and reflected in Discord buttons.
- Assignment lock is scheduled and sends individual assignment or waitlist DMs
  after confirmed assignment.
- Campaign records exist, event tables and RSVPs can reference campaigns, and
  matching campaign RSVPs receive soft seating priority for tables running that
  campaign.
- Discord publication, thread, role, message-job, and audit failure surfaces are
  partially observable through metrics and API endpoints.

## Recommended Build Order

1. Durable committed notifications with retry, dedupe, and audit.
2. Idempotent automatic series generation under concurrency.
3. Campaign workflows on top of the new campaign schema.
4. Remaining signup-option enforcement or removal from exposed UI.
5. Per-system DM capacity and multi-offer semantics.
6. Waitlist promotion and post-lock reassignment rules.
7. Cancellation, rescheduling, and post-RSVP eligibility-change behavior.
8. Discord sync failure dashboard, retry, and reconciliation workflows.
9. End-to-end scenario tests for the main lifecycle.
10. UX polish and optional integrations.

## Core Remaining Production Work

- TODO: Make assignment and waitlist notifications durable, deduplicated,
  retryable, and auditable per recipient instead of fire-and-forget after lock.
- TODO: Make automatic series generation concurrency-safe with a uniqueness or
  idempotency guard so multiple workers cannot create duplicate occurrences.
- TODO: Build the campaign operating workflow around the new schema: dashboard
  and/or Discord flows to create campaigns, attach tables, capture campaign RSVP
  intent, maintain membership, and show continuity priority.
- TODO: Complete dynamic DM capacity: per-system soft/hard defaults,
  occurrence-specific overrides, capacity ownership, and multi-offer accounting
  where one DM cannot contribute duplicate capacity.
- TODO: Finish the participant status model across RSVP, participant,
  assignment, guest, and notification states, including whether
  guaranteed-but-unassigned is persistent or only a derived state.
- TODO: Define and implement waitlist promotion and reassignment behavior after
  committed assignments when a player cancels, a DM withdraws, or capacity
  changes.
- TODO: Handle occurrence cancellation and rescheduling end to end, including
  existing RSVPs, assignments, guests, waitlists, attendance records,
  reconfirmation, and user notifications.
- TODO: Define post-RSVP eligibility-change behavior when a user loses a role or
  eligibility rules change after registration.

## Series And Recurrence

- TODO: Add alternating program support beyond weekly and biweekly recurrence.
- TODO: Expose every supported recurrence mode consistently across dashboard and
  Discord creation flows.
- TODO: Expand series-carried configuration beyond current copied signup
  settings and signup windows to include channels, roles, eligibility rules,
  notification policy, assignment defaults, and campaign/table defaults.
- TODO: Define which generated occurrence fields are copied once, inherited
  dynamically, or overrideable per occurrence.
- TODO: Add a post-event flow that points participants to the next opened RSVP
  for the series.
- TODO: Define recovery behavior when a configured Discord channel or role is
  deleted after a series or event is created.

## Registration Rules

- TODO: Decide whether users may RSVP for multiple distinct events or series in
  the same week or same event night.
- TODO: Decide whether RSVP preferences may be edited after registration closes
  or after assignment lock.
- TODO: Decide whether late RSVPs should be rejected, waitlisted, or require
  organizer approval.
- TODO: Decide whether editing an RSVP preserves the original signup timestamp
  for priority and tie-breaking.
- TODO: Add separate player and DM registration deadlines if the product needs
  them.

## Campaigns And Persistent Tables

- TODO: Add campaign lifecycle states and rules for completion, cancellation, GM
  replacement, skipped weeks, substitute players, and player exit.
- TODO: Decide whether campaign membership is formal, preference-based, or
  inferred from previous assignments.
- TODO: Require fresh RSVP per occurrence while preserving returning-player
  campaign priority.
- TODO: Decide whether event tables are generated from persistent campaigns or
  linked to campaigns per occurrence.
- TODO: Add staff-facing explanations for campaign continuity decisions.

## Assignment, Capacity, And Preferences

- TODO: Make the assignment priority order explicit and deterministic across
  locked manual assignments, returning campaign members, explicit table/GM
  preferences, party/seating groups, RSVP order, guests, and no-preference
  players.
- TODO: Convert `PREFER_PLAYER` into assignment behavior, not just stored
  preference data.
- TODO: Add campaign, persistent table, game system, play category, and
  preferred-player targets where product rules require them.
- TODO: Explain assignment and waitlist decisions in the dashboard without
  exposing private preference, eligibility, attendance, or restricted-program
  information.
- TODO: Define assignment stability before lock and after player-facing
  notifications have been sent.
- TODO: Store committed assignment runs as revisions with inputs, rules,
  results, recalculation reason, and notification diff.
- TODO: Allow rollback to a prior committed assignment revision where
  operationally safe.

## Signup Options And Event Program Configuration

- TODO: Enforce or hide the remaining exposed signup-option toggles:
  `requiresRsvp`, `requiresAmbassadors`, `requiresTableAssignment`,
  `usesWaitlist`, `createsTemporaryRoles`, `requiresAttendanceConfirmation`,
  `sendsFeedbackPrompts`, and `allowsNameOnlyWalkIns`.
- TODO: Replace fixed participation role assumptions with configurable
  per-series participation types such as player, GM, backup GM, apprentice GM,
  campaign participant, observer, and event-specific custom roles.
- TODO: Replace hard-coded D&D Normal/Heroic/Mixed categories with configurable
  category sets per game system or event series.
- TODO: Add configurable RSVP questions and modals per event or series beyond
  the current built-in signup-option toggles.
- TODO: Decide whether configurable participation types are labels mapped onto
  built-in behaviors or fully configurable behavior controlling capacity,
  assignment, eligibility, attendance, and notifications.

## Administration, Discord UX, And Permissions

- TODO: Add scoped delegated management beyond guild-wide staff/admin access,
  including owner, administrator, event manager, series/table manager,
  assignment-only, attendance-only, and settings-management scopes.
- TODO: Replace remaining raw Discord snowflake entry with dashboard selectors
  for known guild roles and any channel fields not yet using selectors.
- TODO: Decide whether `/event create`, `/event cancel`, `/event assign`, and
  `/event table` are long-term supported admin interfaces, emergency shortcuts,
  or temporary dashboard substitutes.
- TODO: Add Discord flows for proposing campaigns or tables if GMs should start
  those workflows without administrator intervention.
- TODO: Ensure Discord and dashboard status copy consistently distinguishes
  registered, guaranteed, assigned, waitlisted, cancelled, and removed.

## Notifications, Staffing, And Observability

- TODO: Add earlier staffing shortage alerts with actionable capacity numbers
  and additional-DM estimates, beyond the current configurable preflight timing.
- TODO: Make notification destinations, role mentions, affected-user DMs, final
  assignment publication, and next-RSVP announcements configurable per event or
  series where needed.
- TODO: Notify users of every committed, user-visible status change, including
  guarantee, waitlist, assignment, reassignment, displacement, cancellation,
  removal, and promotion, while suppressing draft recalculation churn.
- TODO: Prevent duplicate or contradictory notifications during rapid
  recalculations and retries.
- TODO: Add dashboard views and retry actions for Discord sync failures surfaced
  by the API.
- TODO: Reconcile message, thread, role, and notification state after bot
  downtime.

## Attendance, Feedback, And Lower Priority Scope

- TODO: Decide whether attendance history affects campaign priority, RSVP
  priority, organizer approval, or reporting only.
- TODO: Decide whether no-show policies are configurable per guild or series and
  whether excused cancellations differ from no-shows.
- TODO: Implement the end-to-end feedback request workflow; current support is
  mostly schema/settings-level.
- TODO: Keep binary event-image upload lower priority than the capacity,
  assignment, campaign, and notification lifecycle.
- TODO: Keep Meetup integration out of the core Artemis workflow for now.

## Decisions To Resolve Before Large Implementation

- TODO: Soft and hard capacity semantics, including whether assignments above
  soft cap but under hard cap are guaranteed.
- TODO: Assignment priority and tie-breaking.
- TODO: Campaign membership and returning-player priority.
- TODO: Participant status model and whether guaranteed-but-unassigned is a
  persistent state.
- TODO: DM offer, approval, and capacity-counting semantics.
- TODO: Occurrence cancellation, rescheduling, and post-RSVP eligibility-change
  behavior.
- TODO: Cross-event RSVP restrictions, if any.
