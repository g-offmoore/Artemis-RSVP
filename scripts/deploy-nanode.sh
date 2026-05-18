#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/artemis}"
ENV_FILE="${ENV_FILE:-/etc/artemis/production.env}"
cd "$PROJECT_DIR"

compose() {
  docker compose --env-file "$ENV_FILE" "$@"
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
compose up -d --no-deps api

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
compose up -d --no-deps web

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
compose up -d --no-deps caddy

echo "9. Restarting bot last"
compose up -d --no-deps bot

echo "10. Verifying bot container state"
sleep 10
compose ps bot
if ! compose ps bot | grep -q "Up"; then
  echo "Bot is not running"
  exit 1
fi

echo "11. Pruning old images after successful deployment"
docker image prune -af --filter "until=168h"

echo "Deployment complete"
