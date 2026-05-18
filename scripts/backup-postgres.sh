#!/usr/bin/env bash
set -euo pipefail

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 1
  fi
}

required DATABASE_URL
required OBJECT_STORAGE_ENDPOINT
required OBJECT_STORAGE_BUCKET
required OBJECT_STORAGE_ACCESS_KEY_ID
required OBJECT_STORAGE_SECRET_ACCESS_KEY
required BACKUP_ENCRYPTION_PASSPHRASE

export AWS_ACCESS_KEY_ID="$OBJECT_STORAGE_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$OBJECT_STORAGE_SECRET_ACCESS_KEY"
export AWS_EC2_METADATA_DISABLED=true

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
plain="$tmpdir/artemis-$stamp.dump"
encrypted="$plain.gpg"
object="s3://$OBJECT_STORAGE_BUCKET/daily/artemis-$stamp.dump.gpg"

pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file "$plain"
gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" --output "$encrypted" "$plain"
aws s3 cp "$encrypted" "$object" --endpoint-url "$OBJECT_STORAGE_ENDPOINT"

echo "Uploaded encrypted backup: $object"
