#!/usr/bin/env bash
set -euo pipefail

cd /opt/artemis/repo

DC="docker compose --env-file /etc/artemis/production.env"

# Wait for a service's Docker healthcheck to report "healthy". A single check after a
# fixed sleep is not enough: on 2026-11-14 the API needed ~10s to pass /readyz, so a
# `sleep 5` check saw "starting" and aborted the deploy halfway (api recreated, web/bot
# not). Fails fast on "unhealthy" or a container that stopped.
wait_healthy() {
  local service="$1" timeout="${2:-180}" waited=0 id status
  id="$($DC ps -q "$service")"
  while true; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    case "$status" in
      healthy)
        echo "$service healthy after ${waited}s"
        return 0
        ;;
      unhealthy | exited | dead)
        echo "$service is $status after ${waited}s"
        $DC logs --tail=200 "$service"
        return 1
        ;;
    esac
    if [ "$waited" -ge "$timeout" ]; then
      echo "$service still '$status' after ${timeout}s"
      $DC logs --tail=200 "$service"
      return 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
}

# The bot has no HEALTHCHECK, so require it to stay running without restarting for a
# settle period (catches crash loops that `restart: unless-stopped` would hide).
wait_stable_running() {
  local service="$1" settle="${2:-20}" id state restarts
  id="$($DC ps -q "$service")"
  sleep "$settle"
  state="$(docker inspect --format '{{.State.Status}}' "$id")"
  restarts="$(docker inspect --format '{{.RestartCount}}' "$id")"
  echo "$service state: $state, restarts: $restarts"
  if [ "$state" != "running" ] || [ "$restarts" != "0" ]; then
    $DC logs --tail=200 "$service"
    return 1
  fi
}

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
wait_healthy api

echo "== Restart web =="
$DC up -d --force-recreate web
wait_healthy web

echo "== Restart caddy =="
$DC up -d --force-recreate caddy

echo "== Restart bot =="
$DC up -d --force-recreate bot
wait_stable_running bot

echo "== Final status =="
$DC ps
docker stats --no-stream
free -h
df -h

echo "Deploy complete. Run /ops check in Discord."
