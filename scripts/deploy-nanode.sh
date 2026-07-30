#!/usr/bin/env bash
set -euo pipefail

cd /opt/artemis/repo

DC="docker compose --env-file /etc/artemis/production.env"

echo "== Current status =="
$DC ps

echo "== Git status =="
git status --short

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is dirty. Commit/stash/reconcile before deploy."
  exit 1
fi

echo "== Pull =="
git pull --ff-only

echo "== Compose config =="
if $DC config | grep -n '\${'; then
  echo "Unresolved compose variables. Stop."
  exit 1
fi

echo "== Build =="
$DC --profile migrate build

echo "== Migrate =="
$DC --profile migrate run --rm migrate

echo "== Restart API =="
$DC up -d --force-recreate api
sleep 5
API_HEALTH="$(docker inspect --format '{{.State.Health.Status}}' "$($DC ps -q api)")"
echo "API health: $API_HEALTH"
if [ "$API_HEALTH" != "healthy" ]; then
  $DC logs --tail=200 api
  exit 1
fi

echo "== Restart web =="
$DC up -d --force-recreate web
sleep 5
WEB_HEALTH="$(docker inspect --format '{{.State.Health.Status}}' "$($DC ps -q web)")"
echo "Web health: $WEB_HEALTH"
if [ "$WEB_HEALTH" != "healthy" ]; then
  $DC logs --tail=200 web
  exit 1
fi

echo "== Restart caddy =="
$DC up -d --force-recreate caddy

echo "== Restart bot =="
$DC up -d --force-recreate bot
sleep 10
BOT_STATE="$(docker inspect --format '{{.State.Status}}' "$($DC ps -q bot)")"
echo "Bot state: $BOT_STATE"
if [ "$BOT_STATE" != "running" ]; then
  $DC logs --tail=200 bot
  exit 1
fi

echo "== Final status =="
$DC ps
docker stats --no-stream
free -h
df -h

echo "Deploy complete. Run /ops check in Discord."
