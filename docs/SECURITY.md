# Artemis Security Notes

- Keep `.env` off git.
- Do not paste production secrets, webhook URLs, OAuth client secrets, database URLs, or bot tokens into tickets, chat, docs, or commit messages.
- Rotate any token or webhook that has ever been committed, logged, screenshotted, or pasted into a shared channel.
- Use separate runtime and migration database credentials.
- Keep `DATABASE_URL` on the limited `artemis_app` role; reserve `DATABASE_MIGRATION_URL` for migration-only DDL work.
- Use TLS for managed PostgreSQL.
- Store Object Storage credentials outside the Nanode.
- Store the backup encryption passphrase separately from Object Storage credentials.
- Do not expose `/metrics` to the public internet; scrape it only through private container access, an SSH tunnel, or a tightly restricted temporary route.
- Keep dashboard access tied to Discord OAuth and each guild's own `GuildSettings.staffRoleIds`/`adminRoleIds`, set via `/ops` in that guild. Leaving a guild's role lists empty permits any authenticated member of that guild.
- `PLATFORM_ADMIN_DISCORD_USER_IDS` bypasses per-guild role checks for the listed Discord user IDs. Keep this list minimal — it grants dashboard access to every guild Artemis manages, not just one.
- `INTERNAL_API_TOKEN` is required; the API now refuses to boot without it (fails closed) rather than silently allowing unauthenticated requests.
- Every internal API call must carry `x-artemis-guild-id` for the guild it's acting on; the API rejects requests where a resource's actual guild doesn't match the asserted header.
- Treat staff notes, player avoid preferences, and guest names as private operational data.
