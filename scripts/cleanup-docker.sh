#!/usr/bin/env bash
set -euo pipefail

docker container prune -f
docker network prune -f
docker image prune -af --filter "until=168h"
docker builder prune -af --filter "until=168h"

echo "Docker cleanup complete. Volumes were not pruned."
