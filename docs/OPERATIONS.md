# Artemis V1 Operations Runbook

## Cost Baseline

Expected minimum monthly infrastructure is not just the app host and database:

- Nanode app host.
- Managed PostgreSQL.
- Object Storage for encrypted logical backups.
- Optional domain, email, paid monitoring, and future larger compute.

Current baseline estimate is about `$26/mo+`: `$5` Nanode, `$16` managed PostgreSQL Shared 1 GB, and `$5` Object Storage minimum. Do not treat `$21/mo` as backup-complete.

## Database Connection Policy

- API owns most Prisma access and business operations.
- Web dashboard calls the API for data access.
- Bot calls the API for business operations.
- Keep explicit low Prisma pool limits through `DATABASE_POOL_MAX`; default API pool is 5.
- `pg-boss` starts with its own small pool through `PGBOSS_POOL_MAX`; default is 2.
- Migrations run as a one-shot deploy job and not alongside heavy traffic.
- The migrate job uses `DATABASE_MIGRATION_URL` for both `prisma migrate deploy` and `pg-boss migrate`.
- The API runtime uses `DATABASE_URL`, which should be the limited `artemis_app` credential.
- After pg-boss migrations, the migrate job grants DML/runtime permissions on the `pgboss` schema to the user parsed from `DATABASE_URL`.
- Prisma Studio is local or temporary only.
- Alert if active DB connections exceed 70% of `DATABASE_PLAN_MAX_CONNECTIONS`.
- If connection pressure appears before CPU/RAM pressure, enable managed PgBouncer or equivalent pooling before scaling app processes.

The Node `pg` clients used by Prisma's adapter and pg-boss normalize `sslmode=require` to libpq-compatible TLS behavior for managed PostgreSQL certificates when no custom `sslrootcert` is supplied. When checking the database manually with `psql`, remove Prisma/driver-only query parameters such as `connection_limit` from the URL. Keep `sslmode=require` for managed PostgreSQL.

## Production Environment Contract

Use `.env.production.example` as the canonical production template and store the real file on the host at `/etc/artemis/production.env`. Do not keep production secrets in the repository or paste them into shared chat.

Canonical names:

- `APP_DOMAIN`, not `APP_BASE_URL`.
- `SESSION_SECRET`, not `NEXTAUTH_SECRET`.
- `DISCORD_TOKEN`, not `DISCORD_BOT_TOKEN`.
- `DATABASE_MIGRATION_URL`, not `MIGRATION_DATABASE_URL`.
- `INTERNAL_API_TOKEN`, not `API_INTERNAL_TOKEN`.

Optional URLs such as `DISCORD_OPS_WEBHOOK_URL` and `FEEDBACK_FORM_URL` may be blank; the API and bot normalize blank strings to unset.

## Nanode Deployment Sequence

Use `scripts/deploy-nanode.sh` on the host. It defaults to `/opt/artemis` and `/etc/artemis/production.env`. Do not run blue/green or duplicate full-stack deployments on the Nanode.

1. Validate Compose configuration with the production env file.
2. Build images on the host.
3. Run the migration one-shot.
4. Restart API.
5. Health-check API `/readyz`.
6. Restart web.
7. Health-check web `/api/healthz`.
8. Restart Caddy.
9. Restart bot last after API is healthy.
10. Verify bot gateway connection and command health.
11. Prune old images after successful deployment.

Equivalent manual commands:

```bash
cd /opt/artemis
docker compose --env-file /etc/artemis/production.env config
docker compose --env-file /etc/artemis/production.env build
docker compose --env-file /etc/artemis/production.env --profile migrate run --rm migrate
docker compose --env-file /etc/artemis/production.env up -d api
docker compose --env-file /etc/artemis/production.env exec -T api node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker compose --env-file /etc/artemis/production.env up -d web caddy bot
docker compose --env-file /etc/artemis/production.env ps
```

Before deploying from a workstation or CI runner, run the Docker smoke path with placeholder env values:

```bash
docker compose --env-file .env.production.example config
docker compose --env-file .env.production.example build
docker compose --env-file .env.production.example run --rm --no-deps -e ARTEMIS_STARTUP_CHECK=true api npm --workspace @artemis/api run start:check
```

## Operator Event Workflow

### First-Time Guild Setup

Before staff create events, configure guild defaults with the `/ops` Discord commands:

```text
/ops set-event-channel  channel:#event-announcements
/ops set-timezone       timezone:America/New_York
```

These settings are stored per guild in the `GuildSettings` table. The dashboard reads them automatically — no env var changes required after initial setup. Run `/ops settings` at any time to see the current values.

Supported IANA timezone values for US stores:

| Store location | Timezone string |
|----------------|----------------|
| Eastern        | America/New_York |
| Central        | America/Chicago |
| Mountain       | America/Denver |
| Pacific        | America/Los_Angeles |
| Hawaii         | Pacific/Honolulu |

### Creating an Event (Dashboard)

1. Open the dashboard at your configured `APP_DOMAIN`.
2. Authenticate with Discord OAuth.
3. Fill in the Create Event form: event name, game, date (date picker), start time, end time, optional image URL, optional description.
4. The Discord channel defaults to the value set by `/ops set-event-channel` (or the `DISCORD_EVENT_CHANNEL_ID` env var as a fallback).
5. Click **Create event**. The API creates the DB record and immediately publishes a Discord embed to the configured channel.
6. You are redirected to the event detail page. The header shows **Discord post →** linking directly to the message.

### Creating an Event (Discord slash command)

```text
/event create  name:D&D Thursday Night  date:6/18/2026  start_time:6:00 PM  end_time:10:00 PM
```

Optional parameters:
- `description` — shown in the Discord embed
- `image` — attach an event poster (Discord CDN URL is stored)
- `game` — D&D (default), Daggerheart, or Board Game

Accepted date formats: `2026-06-18` or `6/18/2026`.  
Accepted time formats: `18:00`, `6:00 PM`, `6PM`, `1800`.

The command uses the guild timezone from `/ops set-timezone` (falls back to `ARTEMIS_EVENT_TIME_ZONE` env var, then `America/New_York`).

### Editing an Event

Open the event detail page and expand **Edit Event**. Changes are saved to the database and the Discord embed is updated automatically if the event has been published.

### Cancelling an Event

Click **Cancel event** on the event detail page. The status is set to CANCELLED and the Discord embed is updated to reflect the cancelled state. The DB record is preserved.

### Publishing and Re-publishing

If the Discord post was not published automatically, or if the original message was deleted, use the **Publish Discord post** / **Refresh Discord post** button on the event detail page or run:

```text
POST /api/v1/events/:id/publish
```

The endpoint edits the existing message if `messageId` is known, or creates a new one if the message is missing or deleted, and updates `messageId` on the event record.

### Image URL Support

Events support an optional image URL. The image appears in the Discord embed and in the dashboard event detail.

Requirements:
- Must be an `https://` URL.
- URL pathname must end in `.png`, `.jpg`, `.jpeg`, `.gif`, or `.webp` (case-insensitive).
- Discord CDN attachment URLs with query parameters (`?ex=...&is=...`) are accepted.

Binary upload to Object Storage is **not yet implemented**. To include an event poster, upload the image to a CDN or Discord channel and paste the URL. This is explicitly tracked as a future improvement.

### Date/Time Validation

Invalid or ambiguous dates return a user-friendly error before the API is called. Common cases:

- Past dates are rejected.
- End times before start times are auto-advanced by 24 hours (midnight crossover allowed).
- Times must be recognizable: `18:00`, `6:00 PM`, `6PM`, `1800`. Bare integers like `1700` without a colon or AM/PM are rejected with a clear example message.

## Next.js Runtime Strategy

- Build Next.js in CI only.
- Deploy `output: "standalone"` runtime output.
- Start with `node apps/web/server.js` inside the runtime image.
- Keep dashboard pages paginated and server-rendered where practical.
- Avoid runtime image optimization on the Nanode unless needed.
- Upgrade to Linode 2 GB if web RSS routinely exceeds 300 MB, swap is used during normal browsing, OOM restarts occur, or total RAM stays above 75%.

## Backup And Restore

Managed PostgreSQL backups are the primary provider recovery layer, but Artemis also writes encrypted logical backups to Object Storage.

Daily backup:

```bash
scripts/backup-postgres.sh
```

Monthly restore drill:

```bash
DRILL_DATABASE_URL=postgresql://... scripts/restore-drill.sh
```

Backup credential rules:

- Object Storage access keys are stored outside the Nanode in the team password manager.
- The encryption passphrase is stored separately from bucket credentials.
- Restore drills must prove a clean environment can download, decrypt, and restore the dump.

Recovery targets:

- RPO: provider-managed restore/PITR within the managed database restore window; worst-case fallback to the most recent daily logical dump.
- RTO v1 target: restore and cut over within 2 hours after an operator begins recovery.

## Metrics Protection

`/metrics` is not public. Caddy returns 404 for public `/metrics`; scrape the API container directly through one of:

- SSH tunnel to the host.
- Local container network access.
- A temporary reverse-proxy route with basic auth and IP allowlist.

The API also requires `METRICS_TOKEN` as a query token. Treat this as defense in depth, not a reason to expose metrics publicly.

## Discord Ops Acceptance

After configuring the bot role and permissions, run:

```text
/ops check
```

The check verifies:

- required intents are active enough for guild interactions;
- the bot can manage roles;
- the bot role is high enough to manage Artemis-owned roles;
- temporary roles can be created/deleted;
- event-style embeds can be posted/edited;
- DMs fail gracefully when closed.

Expected manual follow-up:

- Confirm the bot role sits above temporary event roles.
- Confirm Discord developer portal intents include the guild members intent.
- Confirm failed Discord operations surface to `DISCORD_OPS_WEBHOOK_URL`.

## Logs And Disk Cleanup

- Docker uses the `local` log driver with bounded log files.
- Weekly cleanup uses `scripts/cleanup-docker.sh`.
- Never automate `docker system prune --volumes`.
- Run `scripts/host-health.sh` from cron or systemd timer.
- Disk thresholds: 70% warning, 85% critical, 90% urgent.

## Known Tradeoffs

This is a cost-conscious production deployment, not a high-availability deployment.

Accepted v1 tradeoffs:

- One Nanode is a single application host.
- One-node managed PostgreSQL is not full HA.
- Brief deploy downtime is acceptable.
- Object Storage backups are required because provider backups alone are not enough.
- Upgrade to Linode 2 GB is expected if dashboard usage or event volume grows.
- Meetup integration is intentionally out of scope.
- Object Storage binary image upload is intentionally out of scope for v1. Use image URLs (https:// with a supported image extension).
- Discord slash commands require re-registration after any change to the `/ops` command definition. This happens automatically on bot restart.
