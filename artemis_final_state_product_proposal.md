# Artemis Final-State Product Proposal

## 1. Executive Summary

Artemis is a Discord-native event operations assistant for community game stores. It helps staff create and manage one-off or recurring events, lets players RSVP with minimal friction, lets ambassadors host sessions using reusable profiles, assigns players to tables when needed, creates temporary event roles for communication, confirms actual attendance after the event, prompts players for feedback, enriches player profiles, and surfaces operational metrics through a web dashboard.

D&D is the first fully modeled workflow because it has the clearest immediate need: recurring events, Normal and Heroic player categories, multiple DMs, guest handling, table balancing, attendance confirmation, and post-session feedback. However, Artemis should not be designed as D&D-only software. D&D should be the first event template in a broader event assistant that can support Daggerheart, social deduction games, mahjong, Tetris, board game nights, learn-to-play events, tournaments, and other store programs.

The product north star is:

> Artemis helps the store answer: what events are coming up, who is attending, who is hosting, where should everyone go, who actually showed up, how did the session go, and what can staff learn from it?

Artemis should reduce event chaos while increasing community continuity.

---

## 2. Product Identity

### Artemis Is

- A Discord-native event operations assistant.
- A replacement for the existing RSVP workflow.
- A table and ambassador assignment tool when the event requires it.
- A source of truth for expected attendance, confirmed attendance, table rosters, waitlists, and post-event outcomes.
- A lightweight community memory system that helps staff, ambassadors, and players build continuity.
- A reporting layer for owners/admins to understand event health.

### Artemis Is Not

- A full virtual tabletop.
- A campaign manager.
- A generic calendar app.
- A personality-matching engine.
- A popularity contest for DMs or ambassadors.
- A rigid system that removes human judgment.
- A web-first platform that forces players out of Discord for basic actions.

### Guiding Product Statement

> Artemis is a Discord-native event operations assistant for community game stores. It manages event creation, RSVP, host signup, table assignment, event communication, temporary mention roles, attendance confirmation, player feedback, profile enrichment, and metrics. D&D is the first complete workflow, but the system is designed around configurable event types so it can support any store event.

---

## 3. Core Design Foundations

### 3.1 Discord Is the Primary Interface

Players, ambassadors, and most staff interactions should happen in Discord through slash commands, buttons, modals, DMs, ephemeral responses, and event embeds.

The web dashboard is for configuration, metrics, staff review, reporting, and deeper event management. Players should not need the dashboard for normal participation.

### 3.2 One Event, Many Tables

For events like D&D, one event post represents the whole game night. DMs/ambassadors claim tables under that event, and players RSVP into the shared event pool.

Example:

- Event: Thursday D&D
- Tables:
  - Alice — Normal Table
  - Ben — Heroic Table
  - Cara — Mixed Table
- Players RSVP once and are assigned appropriately.

The system should avoid modeling each DM table as its own public event unless a specific event type truly requires that.

### 3.3 Profiles Store Defaults; Events Store Decisions

Long-term preferences belong in profiles. Weekly or event-specific choices belong on event participation records.

Example:

- Ambassador profile:
  - Default table type: Heroic
  - Default soft cap: 6
  - Default hard cap: 7
- This event:
  - Running Normal
  - Soft cap: 5
  - Hard cap: 5

This keeps repeated event participation simple while preserving flexibility.

### 3.4 Artemis Captures Planned State and Actual State

The system should distinguish between:

- RSVP: someone intends to attend.
- Assignment: Artemis or staff expects them to sit at a specific table/session.
- Confirmed attendance: they actually attended.
- Feedback: they reported on the experience afterward.

Metrics should prioritize confirmed attendance over RSVP count when measuring real event outcomes.

### 3.5 Automation Assists; Staff Decides

Artemis should automate repetitive work, suggest balanced assignments, and surface warnings. It should not remove staff authority.

Admins must be able to override assignments, lock tables, move players, update attendance, correct guest entries, and audit changes.

### 3.6 Clarity Beats Cleverness

The system should be explainable. Staff should be able to understand why a player was assigned to a table, why someone was waitlisted, why a table overflowed beyond soft cap, or why a role was created.

A simple transparent assignment rule is better than a complex opaque optimization model.

---

## 4. Decision Hierarchy

When product choices, automation rules, or user preferences conflict, Artemis should resolve them in this order.

### 1. Community Safety and Store Standards

The system must protect the store environment first.

This includes:

- PG-13 expectations.
- New player onboarding.
- Staff screening needs.
- Player restrictions.
- Ambassador comfort.
- Admin/owner authority.
- Sensitive staff notes.

If a player preference conflicts with a safety or staff rule, the safety/staff rule wins.

### 2. Operational Truth

Artemis should track what actually happened, not just what was planned.

RSVPs and assignments are useful before an event. Confirmed attendance is the operational truth after the event.

### 3. Hard Constraints

Hard constraints should not be broken automatically.

Examples:

- Ambassador hard capacity.
- Locked event.
- Locked table.
- Locked assignment.
- Player restriction.
- Table eligibility rule.
- Event cancellation.

Admins may override some hard constraints only if the system records the override clearly.

### 4. Eligibility and Compatibility

Players should be routed to tables/events they are eligible for.

For D&D:

- Normal players should normally be routed to Normal or approved Mixed tables.
- Heroic players may play Heroic or Normal, depending on table rules.
- Mixed tables can accept multiple categories if configured.

For other events, eligibility should be configurable by event template.

### 5. Social Grouping

The system should avoid splitting people who reasonably expect to participate together.

This includes:

- A player and their guests.
- Couples.
- Parent/child groups.
- Friends who intentionally sign up together.
- Small party groups.

Social grouping is a strong soft constraint unless staff marks it as required.

### 6. Ambassador Comfort and Soft Caps

Soft caps should be respected whenever possible. A soft cap means the preferred comfortable table size. A hard cap means the automatic assignment engine must not exceed it.

Artemis should fill tables evenly under soft cap first, then only exceed soft caps when necessary and allowed.

### 7. Balanced Distribution

The system should avoid overloading one ambassador while underusing another compatible ambassador.

Balance means:

- No unnecessary overload.
- Willing ambassadors are used appropriately.
- Table sizes are sensible.
- New players have a clear landing place.
- Waitlists are minimized without violating hard constraints.

### 8. Preferences

Preferences matter, but they do not dominate.

Preference examples:

- Preferred ambassador.
- Preferred table style.
- Preferred session tone.
- Prefer more roleplay.
- Prefer less horror.
- Prefer beginner-friendly.

Preferences should influence assignment only after safety, eligibility, grouping, caps, and balance are satisfied.

### 9. Convenience and Automation

Automation should reduce friction, not create confusion.

Examples:

- Automatic recurring event creation.
- Automatic role creation.
- Automatic assignment recalculation.
- Automatic post-session attendance prompts.
- Automatic feedback prompts.
- Automatic role cleanup.

Automation should always be auditable and overridable.

---

## 5. Core Domain Model

### 5.1 Event Series

An Event Series represents a recurring event pattern.

Examples:

- Thursday D&D
- Saturday D&D
- Monthly Daggerheart
- Friday Social Deduction

Event Series fields:

- Name
- Game/event type
- Default channel
- Default recurrence pattern
- Signup open timing
- Signup close timing
- Default role cleanup timing
- Default feedback behavior
- Default attendance confirmation behavior

### 5.2 Event

An Event is a specific occurrence.

Examples:

- Thursday D&D — May 14
- Saturday D&D — May 16
- Daggerheart Learn-to-Play — June 2

Event fields:

- Title
- Event type
- Game system
- Start time
- End time
- Signup opens at
- Signup closes at
- Status
- Discord channel ID
- Discord message ID
- Event series ID, if recurring
- Role cleanup date
- Feedback window
- Created by
- Created at / updated at

Event statuses:

- Draft
- Scheduled
- Signup Open
- Signup Closed
- Locked
- In Progress
- Completed
- Cancelled
- Archived

### 5.3 Event Type / Template

Event types define behavior.

Examples:

- D&D Session Night
- Learn-to-Play
- Social Deduction
- Tournament
- Open Play
- Board Game Night

Event type configuration:

- Requires RSVP?
- Allows guests?
- Max guests per RSVP?
- Requires ambassadors?
- Requires table assignment?
- Uses player categories?
- Creates temporary roles?
- Requires attendance confirmation?
- Sends feedback prompts?
- Uses waitlist?
- Allows external intake?

### 5.4 Ambassador Profile

An Ambassador is a person who hosts, runs, teaches, judges, or facilitates an event.

For D&D, an ambassador is usually a DM.

Ambassador profile fields:

- Discord user ID
- Display name
- Supported event types
- Supported game systems
- Default soft cap
- Default hard cap
- Default table/session type
- Default tags
- Active/inactive status
- Notes
- Created at / updated at

### 5.5 Player Profile

A Player Profile represents a Discord user or linked participant who attends events.

Player profile fields:

- Discord user ID
- Server display name
- Preferred name / nickname
- Current character name, if relevant
- Default player category
- Role-detected player category
- Manual override category
- Attendance history
- Feedback history
- Optional staff notes
- Created at / updated at

For D&D, the common display pattern should be supported:

- CharacterName (PlayerName)

Example:

- Thorne (Alex)

### 5.6 Event Table / Session

An Event Table is a hosted session under an event.

For D&D, this is a DM’s table.

Fields:

- Event ID
- Ambassador profile ID
- Table/session title
- Table type
- Soft cap
- Hard cap
- Description
- Tags
- Status
- Locked flag
- Created at / updated at

Statuses:

- Open
- Full
- Locked
- Cancelled
- Completed

### 5.7 RSVP

An RSVP represents a primary participant’s intent to attend an event.

Fields:

- Event ID
- Primary participant ID
- Selected player category
- RSVP status
- Party/group ID
- Source
- Created at / updated at

Statuses:

- Going
- Cancelled
- Waitlisted
- Removed

### 5.8 Event Participant

An Event Participant is a person occupying a seat or attendance record for an event.

This includes primary RSVP players, Discord-linked guests, name-only guests, and walk-ins.

Fields:

- Event ID
- RSVP ID, nullable for walk-ins
- Participant type: Primary, Guest, Walk-in
- Discord user ID, nullable
- Entered name, nullable
- Display name
- Preferred name
- Character name
- Player category
- Party owner participant ID
- Feedback eligible
- Message eligible
- Role eligible
- Attendance eligible
- Assignment eligible
- Confirmation status
- Linked player profile ID, nullable
- Created by
- Created at / updated at

### 5.9 Assignment

An Assignment connects an Event Participant to an Event Table.

Fields:

- Event ID
- Event participant ID
- Event table ID
- Status
- Locked flag
- Assignment reason
- Assigned by: system or staff user
- Created at / updated at

Statuses:

- Assigned
- Waitlisted
- Unassigned
- Removed
- Moved

### 5.10 Attendance Record

An Attendance Record captures actual attendance after the event.

Fields:

- Event ID
- Event table ID
- Event participant ID
- RSVP ID, nullable
- Status
- Confirmed by ambassador/staff
- Confirmed at
- Source
- Notes

Statuses:

- Attended
- No-show
- Walk-in
- Excused
- Unknown

### 5.11 Feedback Request

A Feedback Request tracks whether a participant was asked for feedback.

Fields:

- Event ID
- Event table ID
- Event participant ID
- Ambassador profile ID
- Attendance record ID
- Status
- Feedback URL
- Sent at
- Submitted at

Statuses:

- Pending
- Sent
- Opened
- Submitted
- Expired
- Skipped

### 5.12 Event Role

An Event Role represents a temporary Discord role created for event communication.

Fields:

- Event ID
- Discord role ID
- Role type: Player or Ambassador
- Name
- Created at
- Expires at
- Deleted at

### 5.13 Audit Log

Any admin-impacting change should be recorded.

Fields:

- Guild ID
- Event ID, nullable
- Actor Discord user ID
- Action
- Before value
- After value
- Created at

Audit examples:

- Player moved tables.
- Table capacity changed.
- Event locked.
- Assignment recalculated.
- Attendance edited.
- Guest added.
- Role cleanup executed.

---

## 6. Guest Handling Policy

Guests are first-class event participants, not just a count.

### 6.1 Guest Types

Artemis supports:

1. Discord-linked guest
2. Name-only guest

A Discord-linked guest has a Discord identity. A name-only guest is represented by a typed name.

### 6.2 Guest Limit

Default max guests per RSVP: 3.

This should be configurable per event. Admins may override if needed.

### 6.3 Name-Only Guest Rules

Name-only guests:

- Are always seated with the person who RSVPed for them.
- Count toward capacity.
- Appear on DM/staff rosters.
- Can be confirmed as attended.
- Count in attendance metrics.
- Do not receive Discord messages.
- Do not receive feedback prompts.
- Do not receive temporary Discord roles.
- Can be linked to a Discord profile later if they join the server.

### 6.4 Discord-Linked Guest Rules

Discord-linked guests:

- Are attached to the primary RSVP owner by default.
- Count toward capacity.
- May receive an optional confirmation message.
- Do not need to confirm for the RSVP to remain valid.
- May decline, which should notify the RSVP owner and update the record.
- May receive event roles if configured.
- May receive feedback prompts only if they attended and are feedback eligible.

### 6.5 Public and Private Visibility

Public event views should show guest counts only.

Example public display:

- Players RSVPed: 18
- Guests: 4
- Total expected: 22

Guest names are visible only to:

- Staff/admins
- Assigned ambassador/DM

### 6.6 Assignment Behavior

A primary RSVP and their guests form a default party group.

Example:

- Geoff RSVPs.
- Geoff adds Jake and Sam as name-only guests.
- Artemis treats the party as three seats and assigns all three together.

### 6.7 Attendance Behavior

After the event, ambassadors can confirm guest attendance alongside registered players.

Example roster:

- Geoff
- Jake, guest of Geoff
- Sam, guest of Geoff

The ambassador may mark each as attended, no-show, moved, or unknown.

### 6.8 Guest Design Principle

> Artemis treats guests as participants attached to the RSVP owner. Guests count toward capacity, assignment, attendance, and metrics. Name-only guests are always seated with the person who RSVPed for them and are excluded from Discord messaging, roles, and feedback prompts. Discord-linked guests may receive optional confirmation messages, but their lack of response does not cancel their attendance. Public views show guest counts only; guest names are visible only to staff and assigned ambassadors.

---

## 7. D&D Event Workflow

D&D is the first complete event template.

### 7.1 Event Pattern

Current expected pattern:

- Thursday and Saturday recurring D&D events.
- A new signup opens for the next week during the current session.
- Players RSVP through Discord.
- DMs sign up to run tables.
- Artemis assigns players to tables.
- After the session, DMs confirm actual attendance.
- Players receive feedback prompts.
- Metrics update in the dashboard.

### 7.2 Player Categories

D&D should support at least:

- Normal
- Heroic
- Mixed/Either table support

Normal players are newer or less familiar with the store’s D&D environment. Heroic players are experienced with the system and community expectations.

The system should support Discord-role detection while allowing manual player selection or staff override.

### 7.3 Player RSVP Flow

Public event embed buttons:

- RSVP Normal
- RSVP Heroic
- Add Guest
- View My Assignment
- Cancel RSVP

Player response after RSVP:

- Confirms selected category.
- Shows current assignment if available.
- Explains if no matching table exists yet.
- Reminds the player that assignments may shift before the event is locked.

### 7.4 DM / Ambassador Signup Flow

DMs should not need admins to create tables for them.

Flow:

1. DM clicks “I’m Running a Table.”
2. Artemis loads their ambassador profile defaults.
3. DM confirms defaults or customizes for this event.
4. Artemis creates the event table/session.
5. Artemis recalculates assignments if appropriate.

Default fields:

- Table type: Normal, Heroic, Mixed
- Soft cap
- Hard cap
- Optional title
- Optional session description
- Optional tags

### 7.5 Assignment Behavior

The assignment engine should consider:

- Player category
- Guest count
- Party grouping
- Table type
- Ambassador soft cap
- Ambassador hard cap
- Existing locked assignments
- Waitlist
- Staff restrictions
- Manual overrides

Assignment should prefer:

1. Valid table type.
2. Keeping RSVP owner and guests together.
3. Staying under soft caps.
4. Balanced table sizes.
5. Avoiding waitlists when possible.

### 7.6 Public Event Embed

The D&D event embed should show public operational state without exposing private guest names or staff details.

Example:

- Thursday D&D — May 14
- Signup: Open
- Normal RSVPs: 8
- Heroic RSVPs: 10
- Guests: 3
- Total expected: 21
- DMs signed up: 3
- Waitlist: 0
- Tables:
  - Alice — Normal — 5/6
  - Ben — Heroic — 6/7
  - Cara — Mixed — 7/8

### 7.7 Staff Event View

Staff should be able to view:

- Full RSVP list
- Guest names
- Table assignments
- Waitlist
- Player categories
- Ambassador capacity
- Locked assignments
- No-shows and walk-ins after confirmation
- Feedback status
- Audit log

---

## 8. Temporary Event Roles

Artemis should create temporary mention-only Discord roles for event communication.

### 8.1 Role Types

For each event, Artemis should create:

- Event Player role
- Event Ambassador role

Examples:

- D&D Thurs May 14 Players
- D&D Thurs May 14 DMs
- D&D Thurs May 21 Players
- D&D Thurs May 21 DMs

### 8.2 Role Creation

Temporary event roles should be created when the event is created, not when the first RSVP occurs.

RSVPs, guest links, and ambassador signups then fill those roles as people interact with the event.

### 8.3 Role Permissions

Temporary event roles must grant no permissions.

They exist only for:

- Event announcements
- Event reminders
- Last-minute updates
- Post-event follow-up
- Targeted community communication

### 8.4 Role Mentionability

Temporary event roles do not need to be staff-mention-only by default.

They should be configurable, but the default assumption is that these roles can be mentioned according to the server's normal role mention policy. They still grant no permissions.

### 8.5 Role Assignment

Player role assignment:

- Primary RSVP receives event player role.
- Discord-linked guest may receive event player role if configured.
- Name-only guest receives no role.

Ambassador role assignment:

- Ambassador receives event ambassador role when they sign up to host/run.

### 8.6 Role Removal

Remove player role when:

- Player cancels RSVP.
- Staff removes RSVP.
- Event cleanup runs.

Remove ambassador role when:

- Ambassador cancels table.
- Staff removes ambassador from event.
- Event cleanup runs.

### 8.7 Cleanup Policy

Default cleanup:

- Delete event roles 14 days after event ends.

This gives staff time to send follow-up messages and feedback reminders without allowing role sprawl.

Cleanup timing should be configurable per event type or guild.

---

## 9. Attendance Confirmation

Confirmed attendance is central to Artemis’s value.

### 9.1 Post-Session Ambassador Prompt

Immediately after an event ends, Artemis should DM each ambassador with the expected roster for their table/session.

Example:

“Thursday D&D attendance check

You were assigned:

- Thorne (Alex)
- Mira (Jess)
- Geoff
- Jake, guest of Geoff

Did this match who was actually at your table?

[Yep, this is correct]
[Edit attendance]
[Add walk-in]
[Mark no-shows]”

### 9.2 Confirmation Actions

Ambassadors can:

- Confirm roster as correct.
- Mark no-shows.
- Add walk-ins.
- Add name-only walk-ins.
- Add Discord-linked walk-ins.
- Move participants to another known table.
- Flag uncertainty.

### 9.3 Walk-In Configuration

Name-only walk-ins should be configurable by event type.

Some event types may allow name-only walk-ins freely. Others may require staff approval or Discord identity.

### 9.4 Staff Confirmation

Staff should be able to confirm or edit attendance on behalf of an ambassador.

### 9.5 Confirmation Reminders

If an ambassador does not confirm attendance, Artemis should send up to two reminders.

Recommended default cadence:

- First reminder: 24 hours after event end.
- Second reminder: 48 hours after event end.

### 9.6 Event Closure

Events should close automatically when either condition is met:

1. All required attendance confirmations are completed.
2. 72 hours have passed since the event occurred.

If staff explicitly requests closure, Artemis should allow the event to close even with incomplete confirmations, while preserving the incomplete confirmation status in metrics.

### 9.7 Failure to Confirm

If an ambassador does not confirm attendance before closure:

- Artemis should mark confirmation as incomplete.
- Staff dashboard should show incomplete confirmation.
- Metrics should distinguish unconfirmed attendance from confirmed attendance.

### 9.8 Attendance Principle

> RSVP data predicts attendance. Assignment data plans attendance. Ambassador confirmation records actual attendance.

---

## 10. Feedback System

Feedback should be tied to confirmed attendance whenever possible.

Artemis will use Google Forms as the current feedback platform.

### 10.1 Current Feedback Form Fields

The current feedback form asks:

- What date did you play?
- Who was your ambassador, DM, Game Master, or Story Teller? Dropdown.
- What game did you play? Dropdown.
- Overall, how would you rate your experience playing in this particular instance? 1 to 5.
- What made your last experience especially memorable for you? Good or bad.
- What other feedback do you have for your ambassadors or LFG staff?
- May we contact you via Discord to get more feedback?
- If yes, what is your Discord username?
- Do we have your permission to use your responses on social media and/or the website?

### 10.2 Feedback Identity

Feedback should be identified, not anonymous.

Artemis should prefill or provide context for the player whenever possible so the submitted form can be associated with:

- Event date
- Event name
- Game played
- Ambassador/DM
- Player Discord identity

### 10.3 Feedback Eligibility

Feedback prompts should be sent to:

- Confirmed attended primary participants.
- Confirmed attended Discord-linked guests, if configured.

Feedback prompts should not be sent to:

- Name-only guests.
- No-shows.
- Unconfirmed participants, unless staff config allows.
- Participants without Discord identity, unless external email/web support exists later.

### 10.4 Feedback Prompt

Example DM:

“Thanks for playing Thursday D&D!

You were marked as attending:

- Date: May 14
- DM: Alice
- Game: D&D
- Table: Heroic

Please take a minute to share feedback:

[Open Feedback Form]”

### 10.5 Google Forms Support

Artemis should support linking to the current Google Form.

If the Google Form supports prefilled URLs, Artemis should prefill:

- Event date
- Event name
- Game played
- Ambassador/DM
- Player Discord username, when appropriate

If reliable prefill is not available, Artemis should still provide those details in the DM immediately above the form link so the player can copy or select them accurately.

### 10.6 Feedback Visibility

Ambassadors should not automatically see raw feedback.

Feedback should be visible to admins/staff first. Staff may choose to share filtered, appropriate feedback with the relevant ambassador.

This protects ambassadors from unfiltered bad-faith or unnecessarily harsh reviews while still allowing useful feedback to reach them.

### 10.7 Feedback Alerts

Artemis will not directly own the Google Form responses, so concerning feedback will not trigger automated staff alerts from Artemis by default.

If the feedback system later moves into Artemis or connects through a reliable Google Forms/Sheets integration, staff alerting can be reconsidered.

### 10.8 Artemis-Native Feedback

Artemis-native feedback is not required for the current product direction.

It remains a possible future enhancement if the store wants:

- Reliable prefill.
- Direct event linkage.
- Completion tracking.
- Dashboard reporting.
- Automated alert routing.
- Configurable visibility and anonymity controls.

---

## 11. Player Profile Enrichment

Artemis should help staff and ambassadors know who players are.

### 11.1 Profile Fields

Player profiles should support:

- Discord user ID
- Discord display name
- Preferred first name / nickname
- Character name
- Display format
- Player category
- Attendance history
- Feedback history
- Optional staff notes

### 11.2 Preferred Name / Nickname

Preferred name or nickname should be optional but encouraged.

For recurring D&D players, Artemis should nudge players toward completing this profile information over time instead of blocking participation upfront.

### 11.3 Character Name

Character name should be stored on the player profile.

This accommodates players who do not have Discord Nitro and cannot repeatedly change server-specific display names. Artemis should not depend on players manually renaming themselves for each event.

### 11.4 D&D Display Pattern

D&D players commonly use:

- CharacterName (PlayerName)

Artemis should support this pattern without requiring it for all event types.

### 11.5 Profile Prompt

Players may be prompted:

“What name should staff/ambassadors use for you at events?”

Optional D&D prompt:

“What character are you currently playing?”

### 11.6 Ambassador Suggestions

Ambassadors may suggest player name or character corrections after a session without requiring staff review first.

Suggested changes should still be recorded in the audit trail. Player-controlled preferred identity should be handled respectfully, and staff should be able to correct misuse if needed.

Example:

- “Thorne is Alex.”

---

## 12. Web Dashboard

The dashboard is the owner/admin view of event operations and trends.

### 12.1 Dashboard Audiences

Primary:

- Owner
- Admins
- Staff

Secondary:

- Ambassadors, limited to their own profile, sessions, and rosters

Optional later:

- Player-facing profile view

### 12.2 Owner Dashboard

Should show:

- Upcoming events
- Event attendance trends
- Event type performance
- Ambassador activity
- Player growth
- New vs returning players
- Feedback summary
- Capacity warnings
- Waitlist trends

### 12.3 Event Dashboard

Should show:

- RSVP list
- Guest count and guest details
- Table/session rosters
- Assignment state
- Waitlist
- Temporary roles
- Attendance confirmation status
- Feedback request status
- Walk-ins
- No-shows
- Audit log

### 12.4 Ambassador Dashboard

Should show:

- Ambassador profile
- Upcoming hosted sessions
- Past sessions
- Attendance confirmation history
- Average table size
- Optional feedback summaries, depending on permission settings

### 12.5 Metrics Dashboard

Core metrics:

- RSVP count
- Confirmed attendance
- No-show rate
- Walk-in count
- Guest count
- Waitlist count
- Attendance by event type
- Attendance by player category
- Ambassador session count
- Average table size
- Soft-cap overflow frequency
- Hard-cap pressure
- Feedback completion rate
- Feedback trends
- New player attendance
- Returning player attendance
- Repeat attendance

D&D-specific metrics:

- Normal attendance
- Heroic attendance
- Normal waitlist pressure
- Heroic waitlist pressure
- DM session counts
- Average players per DM
- Normal-to-Heroic progression, if tracked
- New player onboarding volume

### 12.6 Metrics Principle

> Metrics should help staff make better operational decisions. Avoid vanity metrics unless they support a real action.

Good metric:

- “Normal players were waitlisted because no Normal DM was available.”

Weak metric:

- “Total button clicks.”

---

## 13. Permissions

### 13.1 Player

Can:

- RSVP.
- Cancel own RSVP.
- Change own player category if event allows.
- Add guests up to event limit.
- View own assignment.
- Update own profile.
- Submit feedback.

Cannot:

- View private guest names outside their RSVP.
- Move other players.
- View staff notes.
- Override assignments.
- Manage event roles.

### 13.2 Ambassador

Can:

- Create/update own ambassador profile.
- Sign up to host/run an event table/session.
- Use or override profile defaults for the event.
- View assigned roster for own table/session.
- Confirm attendance for own table/session.
- Add walk-ins to own attendance confirmation.
- Suggest player identity corrections.

Cannot by default:

- Edit other ambassadors’ tables.
- Move players between unrelated tables without staff permission.
- View sensitive staff notes.
- Override locked assignments.

### 13.3 Staff/Admin

Can:

- Create/edit/cancel events.
- Manage event templates.
- Manage RSVP records.
- Manage guest entries.
- Move players.
- Lock assignments.
- Lock tables.
- Override categories.
- Confirm attendance for ambassadors.
- View private event details.
- View dashboard metrics.
- Manage temporary roles.

### 13.4 Owner/System Admin

Can:

- Configure guild settings.
- Configure role mappings.
- Configure permission roles.
- Configure event series.
- Configure external integrations.
- View full audit logs.
- Manage dashboard access.

---

## 14. Assignment Engine

### 14.1 Inputs

The assignment engine should consider:

- Event configuration
- Event type rules
- Player category
- Guest count
- Party grouping
- Table-style preferences
- Player-with-player preferences
- Player avoidance preferences
- Ambassador tables/sessions
- Table type
- Soft caps
- Hard caps
- Locked assignments
- Manual overrides
- Staff restrictions
- Waitlist state

Player-with-player and player avoidance preferences should be visible only to admins and staff.

### 14.2 Outputs

The engine should produce:

- Assigned participants by table/session
- Unassigned participants
- Waitlisted participants
- Warnings
- Explanation metadata

### 14.3 Assignment Warnings

Examples:

- No Normal table available.
- Party could not be kept together.
- All matching tables are at soft cap.
- Hard cap prevents assignment.
- Ambassador coverage is insufficient.
- Locked assignment causes imbalance.
- Player preference or avoidance rule could not be honored.

### 14.4 Assignment Timing

Artemis should not automatically rebalance every time a new ambassador signs up.

Default D&D behavior:

- Collect RSVPs and ambassador signups during the signup window.
- Perform table assignment once, one hour before the event.
- Notify players and ambassadors after assignments are set.
- Do not automatically move players after notification.

After assignment notification, further changes should require staff action or an explicit recalculation command.

### 14.5 Recalculation Triggers

Before the one-hour assignment point, Artemis may track changes without finalizing assignments.

Assignments may be recalculated manually when:

- Admin requests recalculation.
- Staff changes capacity.
- Staff changes table type.
- Staff unlocks assignments.
- A major event change occurs.

Routine RSVP changes before the assignment point should be included in the scheduled assignment pass.

### 14.6 Previewing Recalculation

A preview step is not required for the default product design.

Because Artemis assigns once near event time and then stops moving players automatically after notification, recalculation preview is not a core requirement. This can be reconsidered later if staff needs more control.

### 14.7 Locking

The system should support locking:

- Individual assignment
- Table/session
- Entire event

Recalculation must respect locks.

### 14.8 Preferences

Artemis should support:

- Table-style preferences.
- Player preference to be seated with specific people.
- Player preference to avoid specific people.

These preferences should be staff/admin-visible only and should influence assignment only after safety, eligibility, hard constraints, guest grouping, and capacity rules.

### 14.9 Assignment Language

Artemis should avoid overly authoritarian language.

Prefer:

- “Suggested assignment”
- “Current table assignment”
- “Staff may adjust assignments before the event”

Avoid:

- “You must sit here”

---

## 15. Notifications

### 15.1 Player Notifications

Players may receive:

- RSVP confirmation.
- Assignment notification.
- Assignment changed notification.
- Waitlist notification.
- Event reminder.
- Event cancelled notification.
- Feedback request.

### 15.2 Discord-Linked Guest Notifications

Discord-linked guests may receive:

- “You were added as a guest” message.
- Optional confirm/decline buttons.
- Event reminder if configured.
- Feedback request if attended and eligible.

Lack of response from a Discord-linked guest should not cancel their guest status.

### 15.3 Ambassador Notifications

Ambassadors may receive:

- Table/session signup confirmation.
- Assignment summary.
- Table reached soft cap.
- Table reached hard cap.
- Event reminder.
- Post-session attendance confirmation prompt.
- Feedback summary, if allowed.

### 15.4 Staff Notifications

Staff may receive alerts for:

- No ambassador coverage.
- No Normal table coverage.
- Waitlist created.
- Ambassador cancels.
- Hard cap pressure.
- Attendance confirmation missing.
- Concerning feedback.
- Role cleanup failure.

---

## 16. External Intake Strategy

Discord should remain the operational source of truth, but Artemis should be designed to accept future external RSVP sources if they become practical.

Potential sources:

- Store/LFG website
- Manual staff entry
- CSV import
- Meetup, aspirational only

### 16.1 Website Intake

The LFG website is partially under store/team control through an outside maintenance relationship.

If website RSVP functionality is added, the preferred behavior is to direct users with Discord accounts into Discord for RSVP. This keeps Discord identity, roles, DMs, reminders, ambassador assignment, and feedback workflows intact.

Website intake may still be useful for discovery, event browsing, or non-Discord users, but Discord should remain the cleanest RSVP path whenever possible.

### 16.2 External RSVP Principle

External intake can create tentative or unmatched attendees. Once an attendee is linked to Discord, Artemis can apply Discord-specific features such as roles, DMs, reminders, and feedback prompts.

### 16.3 Meetup

Meetup should remain aspirational and outside the core product plan.

Its limitations make it a poor fit for the Discord-native workflows Artemis depends on, including role assignment, direct messages, profile management, and server-based interactions.

---

## 17. Success Criteria

Artemis is successful when:

- Players can RSVP quickly and confidently.
- Players can add up to three guests without staff involvement.
- Guest counts are public, but guest names remain private.
- DMs/ambassadors can sign up using saved defaults.
- Staff can see the full state of an event at a glance.
- Assignments reduce start-of-event confusion.
- Ambassador hard caps are respected automatically.
- Soft caps are respected when possible.
- Normal players are routed appropriately.
- Heroic players retain flexibility.
- Temporary event roles make communication easier without creating role clutter.
- Ambassadors confirm actual attendance after events.
- Walk-ins and no-shows are captured.
- Players are prompted for feedback.
- Dashboard metrics show event health over time.
- Staff can override anything important.
- The event starts calmer than it did under the previous RSVP system.

The blunt success test:

> If Artemis does not make event night calmer and post-event follow-up clearer, it has failed.

---

## 18. Product Boundaries and Non-Goals

### In Scope

- Discord RSVP
- Event creation
- Recurring events
- Ambassador profiles
- Player profiles
- Guest handling
- Table/session assignment
- Temporary mention roles
- Attendance confirmation
- Feedback prompting
- Metrics dashboard
- Staff overrides
- Audit logs
- Configurable event templates

### Out of Scope Unless Later Justified

- Full campaign management
- Character sheet management
- Deep player personality matching
- VTT features
- Payment processing
- Complex third-party marketplace integrations
- Public player ranking
- Ambassador leaderboards that could shame volunteers
- Mandatory web dashboard use for normal players

---

## 19. Resolved Product Decisions

The following decisions are now part of the final product direction.

### 19.1 Feedback

- Current feedback platform: Google Forms.
- Feedback is identified, not anonymous.
- Artemis should send feedback prompts after confirmed attendance.
- Artemis should link to the existing Google Form.
- If possible, Artemis should use Google Forms prefilled links for date, game, ambassador/DM, and Discord username.
- If prefill is not reliable, Artemis should provide those details in the DM above the form link.
- Ambassadors should not automatically see raw feedback.
- Admins/staff may choose what feedback to share with ambassadors.
- Artemis will not trigger concerning-feedback alerts while Google Forms remains external and unmanaged by Artemis.

Current Google Form fields:

- What date did you play?
- Who was your ambassador, DM, Game Master, or Story Teller?
- What game did you play?
- Overall experience rating from 1 to 5.
- What made the experience memorable, good or bad?
- Other feedback for ambassadors or LFG staff.
- May staff contact you via Discord for more feedback?
- If yes, what is your Discord username?
- Permission to use responses on social media and/or the website.

### 19.2 Attendance

- Ambassadors should receive attendance confirmation prompts immediately after the event.
- Artemis should send up to two reminders if an ambassador does not confirm.
- Events should close automatically 72 hours after occurrence or when all attendance is confirmed.
- Staff may request closure before all attendance is confirmed.
- Incomplete confirmations should remain visible in metrics.
- Name-only walk-ins should be configurable by event type.

### 19.3 Player Identity

- Preferred name/nickname should be optional but encouraged.
- Artemis should nudge recurring D&D players toward completing profile identity information over time.
- Character name should be stored on the player profile.
- This avoids depending on Discord server nickname changes, especially for players without Nitro.
- Ambassadors may suggest name or character corrections without staff review.
- Suggested changes should be auditable.

### 19.4 Temporary Roles

- Event roles should be created when the event is created.
- RSVPs and ambassador signups should fill those roles.
- Temporary roles should grant no permissions.
- Temporary roles are for mentions and event communication.
- Default cleanup should be 14 days after the event.
- Temporary event roles do not need to be staff-mention-only by default.

### 19.5 Assignment

- Artemis should not rebalance every time a new ambassador signs up.
- Default assignment timing should be one hour before the event.
- Once assignments are sent to players, Artemis should not move players automatically.
- Later changes should require staff action or explicit recalculation.
- Staff recalculation preview is not required in the default design.
- Artemis should support table-style preferences.
- Artemis should also support player preferences for who they want to sit with or avoid.
- Player preference and avoidance data should be visible only to admins and staff.

### 19.6 Broader Event Support

The first non-D&D event types to model are:

- Daggerheart
- Boardgame looking-for-group events
- Other TTRPG events, such as Marvel and Star Wars

All three should support:

- Ambassadors
- Table/session assignment
- Post-event feedback

### 19.7 External Intake

- The LFG website is partially under store/team control through an outside maintenance relationship.
- Users with Discord should be directed to Discord for RSVP.
- Website intake can remain a later integration point.
- Meetup should remain aspirational and outside the core plan.
- Meetup is effectively a dead option unless its integration limitations change.

### 19.8 Remaining Open Questions

The major product direction is now clear. Remaining decisions are implementation-level rather than product-defining.

Open implementation questions:

1. What is the exact Google Form URL and can it support reliable prefilled parameters?
2. What Discord roles currently identify staff, admins, ambassadors, Normal players, and Heroic players?
3. What should the default one-hour assignment notification message say to players and ambassadors?
4. Should the two attendance reminders be sent at 24/48 hours, or another cadence inside the 72-hour closure window?
5. For each event template, should name-only walk-ins default to allowed or staff-only?
6. What exact naming convention should temporary roles use to stay readable and unique?

---

## 20. Final North Star

> Artemis is the store’s event operations assistant. It starts with Discord-native RSVP and D&D table assignment, but its real job is to manage the full lifecycle of community events: planning, signups, ambassadors, guests, assignments, communication, attendance, feedback, profile continuity, and metrics. It should make events easier to run, easier to attend, easier to improve, and easier to understand over time.

