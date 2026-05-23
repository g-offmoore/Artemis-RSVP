#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://app.artemisrsvp.com}"
KNOWN_EVENT_ID="${KNOWN_EVENT_ID:-}"

if [[ -z "$KNOWN_EVENT_ID" ]]; then
  echo "KNOWN_EVENT_ID is required for /events/<known-id> smoke test"
  exit 1
fi

routes=(
  "/"
  "/settings"
  "/series"
  "/ambassadors"
  "/events/${KNOWN_EVENT_ID}"
)

for route in "${routes[@]}"; do
  url="${BASE_URL}${route}"
  status=$(curl -sS -o /dev/null -w '%{http_code}' "$url")

  if [[ "$status" == "404" ]]; then
    echo "Smoke test failed: ${url} returned 404"
    exit 1
  fi

  echo "Smoke test: ${url} -> ${status}"
done

echo "Post-deploy smoke checks passed"
