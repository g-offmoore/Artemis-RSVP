#!/usr/bin/env bash
# Host health check for the Artemis Nanode. Intended to run from cron every 15 minutes.
#
# Prints every finding on each run (for the cron log), but only posts to the Discord ops
# webhook when the set of problems changes (new problem, or all clear) or once a day while
# a problem persists, so a lingering warning does not post ~96 times a day.
set -euo pipefail

ENV_FILE="${ARTEMIS_ENV_FILE:-/etc/artemis/production.env}"
STATE_DIR="${ARTEMIS_STATE_DIR:-$HOME/.local/state/artemis}"
STATE_FILE="$STATE_DIR/host-health.state"
REMIND_SECONDS="${HOST_HEALTH_REMIND_SECONDS:-86400}"
EXPECTED_SERVICES="${HOST_HEALTH_EXPECTED_SERVICES:-artemis-api-1 artemis-web-1 artemis-bot-1 artemis-caddy-1}"

# Cron does not load the env file, so read just the webhook URL from it (without sourcing
# the whole file, which holds every production secret).
if [[ -z "${DISCORD_OPS_WEBHOOK_URL:-}" && -r "$ENV_FILE" ]]; then
  DISCORD_OPS_WEBHOOK_URL="$(sed -n 's/^DISCORD_OPS_WEBHOOK_URL=//p' "$ENV_FILE" | tail -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
fi

keys=()
messages=()
problem() {
  keys+=("$1")
  messages+=("$2")
  echo "PROBLEM: $2"
}

disk_percent="$(df --output=pcent / | tail -n 1 | tr -dc '0-9')"
if ((disk_percent >= 90)); then
  problem disk-urgent "URGENT disk usage ${disk_percent}%"
elif ((disk_percent >= 85)); then
  problem disk-critical "critical disk usage ${disk_percent}%"
elif ((disk_percent >= 70)); then
  problem disk-warning "warning disk usage ${disk_percent}%"
fi

# On a 1 GB Nanode a few hundred MB of swap holding idle pages is normal steady state
# (~240MB right after a deploy), so alert on real memory pressure instead.
swap_used="$(free -m | awk '/^Swap:/ {print $3}')"
if ((swap_used > ${HOST_HEALTH_SWAP_MB:-1024})); then
  problem swap "swap usage is ${swap_used}MB"
fi
mem_available="$(free -m | awk '/^Mem:/ {print $7}')"
if ((mem_available < ${HOST_HEALTH_MIN_AVAILABLE_MB:-96})); then
  problem low-memory "only ${mem_available}MB memory available"
fi

unhealthy="$(docker ps --filter health=unhealthy --format '{{.Names}}' | paste -sd ',' -)"
if [[ -n "$unhealthy" ]]; then
  problem unhealthy "unhealthy containers: $unhealthy"
fi

running=" $(docker ps --filter status=running --format '{{.Names}}' | paste -sd ' ' -) "
not_running=""
for service in $EXPECTED_SERVICES; do
  [[ "$running" == *" $service "* ]] || not_running+="${not_running:+,}$service"
done
if [[ -n "$not_running" ]]; then
  problem not-running "containers not running: $not_running"
fi

failed_units="$(systemctl --failed --no-legend --plain | awk '{print $1}' | paste -sd ',' -)"
if [[ -n "$failed_units" ]]; then
  problem failed-units "failed systemd units: $failed_units"
fi

current_keys="$(printf '%s\n' "${keys[@]+"${keys[@]}"}" | sed '/^$/d' | sort | paste -sd ',' -)"
previous_keys=""
last_sent=0
if [[ -r "$STATE_FILE" ]]; then
  previous_keys="$(sed -n 's/^keys=//p' "$STATE_FILE")"
  last_sent="$(sed -n 's/^last_sent=//p' "$STATE_FILE")"
fi
now="$(date +%s)"

notify=""
if [[ "$current_keys" != "$previous_keys" ]]; then
  if [[ -n "$current_keys" ]]; then
    notify="$(printf '%s; ' "${messages[@]}")"
  else
    notify="all clear (previously: $previous_keys)"
  fi
elif [[ -n "$current_keys" ]] && ((now - ${last_sent:-0} >= REMIND_SECONDS)); then
  notify="still failing: $(printf '%s; ' "${messages[@]}")"
fi

if [[ -n "$notify" ]]; then
  echo "NOTIFY: $notify"
  if [[ -n "${DISCORD_OPS_WEBHOOK_URL:-}" ]]; then
    payload="$(printf 'Artemis host health (%s): %s' "$(hostname)" "${notify%; }" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    curl -fsS --max-time 10 -X POST "$DISCORD_OPS_WEBHOOK_URL" \
      -H "content-type: application/json" \
      -d "{\"content\":\"$payload\"}" >/dev/null || echo "webhook post failed"
  fi
  last_sent="$now"
fi

mkdir -p "$STATE_DIR"
printf 'keys=%s\nlast_sent=%s\n' "$current_keys" "${last_sent:-0}" >"$STATE_FILE"

echo "Host health check complete ($(date -u +%FT%TZ)): ${current_keys:-ok}"
