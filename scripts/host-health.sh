#!/usr/bin/env bash
set -euo pipefail

warn() {
  local message="$1"
  echo "$message"
  if [[ -n "${DISCORD_OPS_WEBHOOK_URL:-}" ]]; then
    curl -fsS -X POST "$DISCORD_OPS_WEBHOOK_URL" \
      -H "content-type: application/json" \
      -d "{\"content\":\"Artemis host health: $message\"}" >/dev/null || true
  fi
}

disk_percent="$(df / | awk 'NR==2 {gsub(/%/, \"\", $5); print $5}')"
if (( disk_percent >= 90 )); then
  warn "CRITICAL disk usage ${disk_percent}%"
elif (( disk_percent >= 85 )); then
  warn "critical disk usage ${disk_percent}%"
elif (( disk_percent >= 70 )); then
  warn "warning disk usage ${disk_percent}%"
fi

swap_used="$(free -m | awk '/Swap:/ {print $3}')"
if (( swap_used > 128 )); then
  warn "swap usage is ${swap_used}MB"
fi

unhealthy="$(docker ps --filter health=unhealthy --format '{{.Names}}' | paste -sd ',' -)"
if [[ -n "$unhealthy" ]]; then
  warn "unhealthy containers: $unhealthy"
fi

failed_units="$(systemctl --failed --no-legend | awk '{print $1}' | paste -sd ',' -)"
if [[ -n "$failed_units" ]]; then
  warn "failed systemd units: $failed_units"
fi

echo "Host health check complete"
