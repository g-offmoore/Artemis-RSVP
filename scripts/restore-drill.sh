#!/usr/bin/env bash
set -euo pipefail

required() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required" >&2
    exit 1
  fi
}

required DRILL_DATABASE_URL
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

latest="$(aws s3 ls "s3://$OBJECT_STORAGE_BUCKET/daily/" --endpoint-url "$OBJECT_STORAGE_ENDPOINT" | awk '{print $4}' | sort | tail -n 1)"
if [[ -z "$latest" ]]; then
  echo "No daily backup found" >&2
  exit 1
fi

aws s3 cp "s3://$OBJECT_STORAGE_BUCKET/daily/$latest" "$tmpdir/latest.dump.gpg" --endpoint-url "$OBJECT_STORAGE_ENDPOINT"
gpg --batch --yes --decrypt --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" --output "$tmpdir/latest.dump" "$tmpdir/latest.dump.gpg"
pg_restore --clean --if-exists --no-owner --no-acl --dbname "$DRILL_DATABASE_URL" "$tmpdir/latest.dump"

psql "$DRILL_DATABASE_URL" -c "select count(*) as events from \"Event\";"
echo "Restore drill succeeded from $latest"
