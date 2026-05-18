#!/usr/bin/env bash
set -euo pipefail

if swapon --show | grep -q /swapfile; then
  echo "swapfile already enabled"
  exit 0
fi

sudo fallocate -l "${SWAP_SIZE:-1G}" /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
echo "swapfile enabled"
