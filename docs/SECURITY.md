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
- Keep dashboard access tied to Discord OAuth and configured guild role IDs.
- Set `DASHBOARD_ALLOWED_ROLE_IDS` in production. Leaving it empty permits any authenticated guild member.
- Treat staff notes, player avoid preferences, and guest names as private operational data.
