-- Persist the Discord guild display name so the dashboard's guild picker can
-- show human-readable names without a live per-request Discord API call.
ALTER TABLE "GuildSettings" ADD COLUMN IF NOT EXISTS "name" TEXT;
