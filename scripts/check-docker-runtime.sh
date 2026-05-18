#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.production.example}"

docker compose --env-file "$ENV_FILE" config >/dev/null
docker compose --env-file "$ENV_FILE" build

docker compose --env-file "$ENV_FILE" run --rm --no-deps api \
  sh -lc 'test -n "$(find packages/db/prisma/migrations -name migration.sql -print -quit)"'

docker compose --env-file "$ENV_FILE" run --rm --no-deps -e ARTEMIS_STARTUP_CHECK=true api \
  npm --workspace @artemis/api run start:check

docker compose --env-file "$ENV_FILE" run --rm --no-deps api \
  node --input-type=module -e 'await Promise.all(["@nestjs/common","@nestjs/core","@nestjs/platform-fastify","@fastify/cors","@fastify/helmet","@fastify/rate-limit","class-transformer","class-validator","@artemis/db","pg-boss","prom-client","zod"].map((name) => import(name)))'

docker compose --env-file "$ENV_FILE" run --rm --no-deps bot \
  node --input-type=module -e 'await Promise.all(["discord.js","pino","zod"].map((name) => import(name)))'

docker compose --env-file "$ENV_FILE" run --rm --no-deps web \
  node --input-type=module -e 'await Promise.all(["next","react","react-dom","lucide-react"].map((name) => import(name)))'
