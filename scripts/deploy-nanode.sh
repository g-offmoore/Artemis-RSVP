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

# Pull the images CI published for this commit. Right after a merge the CI publish job may
# still be running, so retry for a while instead of failing immediately.
wait_for_images() {
  local timeout="${ARTEMIS_IMAGE_WAIT_SECONDS:-1200}" waited=0
  until $DC pull --quiet api web bot caddy; do
    if [ "$waited" -ge "$timeout" ]; then
      echo "Images ${ARTEMIS_IMAGE_PREFIX}/*:${ARTEMIS_IMAGE_TAG} not in the registry after ${timeout}s."
      echo "Check the publish-images job in GitHub Actions for this commit, or deploy with ARTEMIS_DEPLOY_MODE=build."
      return 1
    fi
    echo "Images for ${ARTEMIS_IMAGE_TAG} not published yet (CI may still be running); retrying in 30s"
    sleep 30
    waited=$((waited + 30))
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

# Images: by default use the ones CI built and pushed to GHCR for this exact commit, so
# the 1 GB host never builds. ARTEMIS_DEPLOY_MODE=build is the fallback that builds on the
# host (slow, memory-hungry; use only if GHCR or CI is unavailable). Exported values take
# precedence over ARTEMIS_IMAGE_PREFIX/ARTEMIS_IMAGE_TAG in the env file.
DEPLOY_MODE="${ARTEMIS_DEPLOY_MODE:-pull}"
case "$DEPLOY_MODE" in
  pull)
    export ARTEMIS_IMAGE_PREFIX="${ARTEMIS_REGISTRY_PREFIX:-ghcr.io/g-offmoore/artemis-rsvp}"
    export ARTEMIS_IMAGE_TAG="sha-$(git rev-parse HEAD)"
    ;;
  build) ;;
  *)
    echo "ARTEMIS_DEPLOY_MODE must be 'pull' or 'build', got '$DEPLOY_MODE'"
    exit 1
    ;;
esac
echo "Deploy mode: $DEPLOY_MODE"

echo "== Compose config =="
if $DC config | grep -n '\${'; then
  echo "Unresolved compose variables. Stop."
  exit 1
fi

if [ "$DEPLOY_MODE" = pull ]; then
  echo "== Pull images =="
  wait_for_images
else
  echo "== Build (on host) =="
  $DC --profile migrate build
fi
$DC images api web bot

echo "== Migrate =="
$DC --profile migrate run --rm migrate

echo "== Restart API =="
$DC up -d --no-build --force-recreate api
wait_healthy api

echo "== Restart web =="
$DC up -d --no-build --force-recreate web
wait_healthy web

echo "== Restart caddy =="
$DC up -d --no-build --force-recreate caddy

echo "== Restart bot =="
$DC up -d --no-build --force-recreate bot
wait_stable_running bot

echo "== Final status =="
$DC ps
docker stats --no-stream
free -h
df -h

echo "Deploy complete. Run /ops check in Discord."
