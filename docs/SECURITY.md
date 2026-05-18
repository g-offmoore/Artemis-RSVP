# Artemis Security Notes

- Keep `.env` off git.
- Rotate any token that has ever been committed or pasted into a shared channel.
- Use separate runtime and migration database credentials.
- Use TLS for managed PostgreSQL.
- Store Object Storage credentials outside the Nanode.
- Store the backup encryption passphrase separately from Object Storage credentials.
- Do not expose `/metrics` to the public internet.
- Keep dashboard access tied to Discord OAuth and configured guild role IDs.
- Treat staff notes, player avoid preferences, and guest names as private operational data.
