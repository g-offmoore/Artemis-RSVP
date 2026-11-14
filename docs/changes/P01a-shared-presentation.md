# P01a - Shared event presentation/vocabulary

Tracking: issue #21. This is prerequisite P01a only. P01 (simplified post and
personal signup panel) is NOT complete: no Join button, ephemeral panel, or
new custom IDs are added here.

## What changed

New framework-neutral module `packages/domain/src/event-presentation.ts`
(also exported as `@artemis/domain/event-presentation` so the web client
component does not pull the full domain index/zod):

- `resolveEventVocabulary(gameSystem)` - D&D / Daggerheart / default labels.
- `buildEventEmbed(event)` - embed descriptor (title, description, fields, image).
- `buildEventButtonRows(event)` - button descriptors (`customId`, `label`,
  `style` 1-4 == Discord ButtonStyle values). `[]` for CANCELLED events.
- `formatDiscordTimestamp` / `formatDiscordTimeRange`.

No discord.js, Discord REST, or Node dependency in the module.

Adapters (thin, runtime-specific):

- Bot: `apps/bot/src/event-post.ts` (moved out of `main.ts` so tests do not
  start the bot) wraps descriptors in `EmbedBuilder` / `ButtonBuilder`.
- API: `discord-event-post.service.ts` maps descriptors to REST payloads
  (`type: 1/2`, `custom_id`). `eventEmbed`/`eventButtons` are now exported
  for testing.
- Web: `actions.ts` and `event-management.tsx` use `resolveEventVocabulary`
  instead of their private copies.

About 180 duplicated lines in the bot and API were removed.

## Preserved behavior (characterized before refactor)

- Labels, button order and count (D&D: 5 + 3; non-D&D: 4 + 3; guests off:
  one fewer), styles, and legacy custom IDs (`rsvp:<id>:NORMAL|HEROIC|MIXED`,
  `guest:`, `host:`, `assignment:`, `backup_dm:`, `cancel_rsvp:`, `prefs:`).
- Cancelled event => no components.
- `eventType.allowsGuests !== false` keeps Guests button (null/undefined keep it).
- Counts exclude `assignmentEligible === false`; cancelled/completed tables
  are inactive; image, "Store event" default description, `SCHEDULED` default
  status, Discord timestamp format.
- Privacy: embed contains only aggregate counts; no participant identities.
- Existing quirk kept deliberately: "No <host> tables yet" lowercases the host
  word ("No dm tables yet", "No gm tables yet").

## Reconciled differences (no user-visible output change)

- Bot accepted ISO-string dates and tolerated missing `tables`/`participants`;
  API accepted `Date` and would throw on missing arrays. Shared builder
  accepts both date forms and tolerates missing arrays. Valid inputs render
  identically to before; only the API's crash-on-missing-array case changes
  (now renders zero counts).
- Web vocabulary was a 2-field subset; it now reads the same source (extra
  fields unused there).

## Test evidence

- Characterization tests written and passing against the pre-refactor code:
  `apps/bot/src/event-post.test.ts` (14), `apps/api/src/events/discord-event-post.service.test.ts` (5).
- RED: `packages/domain/src/event-presentation.test.ts` failed to load
  (module did not exist).
- GREEN: same file 19/19 after implementation; bot and API adapter tests
  additionally assert output equals the shared descriptors for a matrix of
  events (D&D, non-D&D, no guests, cancelled, image/no tables), alongside the
  literal goldens above (so parity is not just two copies of one mock).
- Full suite, typecheck, lint, `check:deploy`, and `next build` of web pass
  (see PR description for counts). Local Node is v26; CI uses Node 24 - not
  re-run on 24 locally.

## Next dependency

P01 panel work (Join button, ephemeral personal panel, new custom IDs) should
build on `buildEventButtonRows` and add any new IDs to the shared module
together with routing in the bot. Legacy IDs must keep routing for already
published posts.

## Revert

`git revert <commit>` restores the duplicated bot/API/web copies; there is no
schema, data, or config change and no deploy ordering requirement.
