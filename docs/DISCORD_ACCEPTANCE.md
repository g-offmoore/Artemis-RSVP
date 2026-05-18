# Discord Operations Acceptance Checklist

Run this before the first production event and after any Discord role hierarchy change.

- Bot is installed in the target guild.
- Bot has `Guilds` and `Guild Members` intents enabled in the Discord developer portal.
- Bot role has `Manage Roles`, `Send Messages`, `Manage Messages`, `Use Slash Commands`, and `Read Message History`.
- Bot role is above all Artemis temporary event roles.
- `/ops check` passes role create/delete and embed edit checks.
- Bot can assign/remove an Artemis-owned role from a test staff member.
- Bot can DM a test user, or closed DMs are handled without crashing.
- Bot can post the event embed and users can click RSVP buttons.
- Rate-limit or failed Discord operations are retried when safe or reported to staff.
- Staff ops channel receives alerts from `DISCORD_OPS_WEBHOOK_URL`.
