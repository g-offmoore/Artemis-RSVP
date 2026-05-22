-- EventRole: make discordRoleId nullable (null = pending / failed creation)
ALTER TABLE "EventRole" ALTER COLUMN "discordRoleId" DROP NOT NULL;

-- EventRole: failure tracking fields
ALTER TABLE "EventRole" ADD COLUMN IF NOT EXISTS "failedAt"   TIMESTAMPTZ;
ALTER TABLE "EventRole" ADD COLUMN IF NOT EXISTS "lastError"  TEXT;

-- GuildSettings: change default cleanup window from 14 days to 7 days
-- (existing rows keep their value; new rows get 7)
ALTER TABLE "GuildSettings" ALTER COLUMN "temporaryRoleCleanupDays" SET DEFAULT 7;

-- EventSeries: change default cleanup window from 14 days to 7 days
ALTER TABLE "EventSeries" ALTER COLUMN "defaultRoleCleanupDays" SET DEFAULT 7;

-- EventSeries: template fields for weekly occurrence generation (v1)
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "defaultTitle"           TEXT NOT NULL DEFAULT '';
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "defaultGameSystem"      TEXT NOT NULL DEFAULT 'D&D';
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "defaultDescription"     TEXT;
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "defaultImageUrl"        TEXT;
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "defaultStartHour"       INTEGER NOT NULL DEFAULT 18;
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "defaultStartMinute"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 240;
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "createdByDiscordId"     TEXT NOT NULL DEFAULT '';
