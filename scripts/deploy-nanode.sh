#!/usr/bin/env bash
set -euo pipefail

# Production runs from /opt/artemis/repo (see rules.md and docs/OPERATIONS.md), not
# /opt/artemis itself.
PROJECT_DIR="${PROJECT_DIR:-/opt/artemis/repo}"
ENV_FILE="${ENV_FILE:-/etc/artemis/production.env}"
cd "$PROJECT_DIR"

compose() {
  docker compose --env-file "$ENV_FILE" "$@"
}

# Recreates a service's container unconditionally and prints the container ID before
# and after so it's obvious in deploy output whether anything actually changed, rather
# than trusting a health check that a stale, untouched container would also pass.
# `--force-recreate` removes reliance on Compose's own "did the config/image change"
# heuristic, which is what silently left web/bot/caddy running two-month-old images
# on 2026-07-30 even though this script reported success end to end.
recreate() {
  local service="$1"
  local before after
  before=$(compose ps -q "$service" 2>/dev/null || true)
  compose up -d --force-recreate --no-deps "$service"
  after=$(compose ps -q "$service" 2>/dev/null || true)
  if [[ -n "$before" && "$before" == "$after" ]]; then
    echo "  WARNING: ${service} container ID did not change (${after}) — recreation may not have taken effect"
  else
    echo "  ${service}: ${before:-<none>} -> ${after}"
  fi
}

echo "1. Validating compose configuration"
compose config >/dev/null

echo "2. Building images"
compose build

echo "2a. DB identity check"
# Extract host and database name from DATABASE_URL to confirm the right target.
# Format: postgresql://user:pass@host:port/dbname?params
_db_url=$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
if [[ -n "$_db_url" ]]; then
  _db_host=$(echo "$_db_url" | sed 's|.*@||' | cut -d/ -f1)
  _db_name=$(echo "$_db_url" | sed 's|.*@[^/]*/||' | cut -d? -f1)
  echo "  Target: ${_db_name} on ${_db_host}"
else
  echo "  WARNING: Could not read DATABASE_URL from $ENV_FILE"
fi

echo "3. Running migration one-shot"
compose --profile migrate run --rm migrate

echo "4. Restarting API"
recreate api

echo "5. Health-checking API"
for i in {1..20}; do
  if compose exec -T api node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 3
  if [[ "$i" == "20" ]]; then
    echo "API readiness failed"
    exit 1
  fi
done

echo "5a. Post-migration database confirmation"
_readyz=$(compose exec -T api node -e \
  "fetch('http://127.0.0.1:3000/readyz').then(r=>r.json()).then(d=>process.stdout.write(JSON.stringify(d))).catch(()=>process.stdout.write('unavailable'))" \
  2>/dev/null || echo "unavailable")
echo "  readyz: ${_readyz}"

echo "6. Restarting web"
recreate web

echo "7. Health-checking web"
for i in {1..20}; do
  if compose exec -T web node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 3
  if [[ "$i" == "20" ]]; then
    echo "Web health failed"
    exit 1
  fi
done

echo "8. Restarting Caddy"
recreate caddy

echo "10. Running post-deploy route smoke checks"
KNOWN_EVENT_ID="${KNOWN_EVENT_ID:?KNOWN_EVENT_ID must be set for smoke checks}" \
BASE_URL="${BASE_URL:-https://app.artemisrsvp.com}" \
./scripts/post-deploy-smoke.sh

echo "11. Restarting bot last"
recreate bot

echo "12. Verifying bot container state"
sleep 10
compose ps bot
if ! compose ps bot | grep -q "Up"; then
  echo "Bot is not running"
  exit 1
fi

echo "13. Pruning old images after successful deployment"
docker image prune -af --filter "until=168h"

echo "Deployment complete"
