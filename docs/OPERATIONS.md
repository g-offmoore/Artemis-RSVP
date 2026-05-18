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
- Prisma Studio is local or temporary only.
- Alert if active DB connections exceed 70% of `DATABASE_PLAN_MAX_CONNECTIONS`.
- If connection pressure appears before CPU/RAM pressure, enable managed PgBouncer or equivalent pooling before scaling app processes.

## Nanode Deployment Sequence

Use `scripts/deploy-nanode.sh` on the host. Do not run blue/green or duplicate full-stack deployments on the Nanode.

1. Pull new images.
2. Run migration one-shot.
3. Restart API.
4. Health-check API.
5. Restart web.
6. Health-check web.
7. Restart bot last.
8. Verify bot gateway connection and command health.
9. Prune old images after successful deployment.

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
