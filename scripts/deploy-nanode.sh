#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/opt/artemis}"
cd "$PROJECT_DIR"

echo "1. Pulling new images"
docker compose pull

echo "2. Running migration one-shot"
docker compose --profile migrate run --rm migrate

echo "3. Restarting API"
docker compose up -d --no-deps api

echo "4. Health-checking API"
for i in {1..20}; do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 3
  if [[ "$i" == "20" ]]; then
    echo "API readiness failed"
    exit 1
  fi
done

echo "5. Restarting web"
docker compose up -d --no-deps web

echo "6. Health-checking web"
for i in {1..20}; do
  if docker compose exec -T web node -e "fetch('http://127.0.0.1:3000/api/auth/login',{redirect:'manual'}).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"; then
    break
  fi
  sleep 3
  if [[ "$i" == "20" ]]; then
    echo "Web health failed"
    exit 1
  fi
done

echo "7. Restarting bot last"
docker compose up -d --no-deps bot

echo "8. Verifying bot container state"
sleep 10
docker compose ps bot
if ! docker compose ps bot | grep -q "Up"; then
  echo "Bot is not running"
  exit 1
fi

echo "9. Pruning old images after successful deployment"
docker image prune -af --filter "until=168h"

echo "Deployment complete"
