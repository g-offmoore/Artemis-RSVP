# Artemis

Artemis is a Discord-native event operations assistant for community game stores.

## Current Structure

- `apps/api`: NestJS 11 Fastify API. Owns database writes and operational endpoints.
- `apps/bot`: Discord.js 14 bot. Uses the API for business operations.
- `apps/web`: Next.js 16 dashboard. Uses Discord OAuth and calls the API.
- `packages/db`: Prisma 7 schema and client factory.
- `packages/domain`: shared assignment, validation, and domain rules.
- `deploy`: Docker, Caddy, and Nanode deployment assets.
- `scripts`: deployment, backup, restore-drill, cleanup, and host-health scripts.
- `docs`: operations and security runbooks.

The old root `src/`, `rsvphandlers.ts`, and `Artemis/` folders are prototype references and are not production entrypoints.

## Local Verification

```bash
npm install
npm run prisma:generate
npm run typecheck
npm test
npm run lint
npm run build
```

## Production Notes

Read [docs/OPERATIONS.md](docs/OPERATIONS.md) before deploying. It defines the cost baseline, database connection budget, Nanode deployment order, backup/restore drills, metrics protection, and known v1 tradeoffs.
