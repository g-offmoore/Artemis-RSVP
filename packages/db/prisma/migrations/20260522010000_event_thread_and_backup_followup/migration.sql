-- Event: private Discord thread tracking and retry counter
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "discordThreadId"   TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "threadRetryCount"  INTEGER NOT NULL DEFAULT 0;

-- EventRole: auto-retry counter
ALTER TABLE "EventRole" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;

-- EventMessageType: add BACKUP_DM_FOLLOW_UP for no-response organizer notification
ALTER TYPE "EventMessageType" ADD VALUE IF NOT EXISTS 'BACKUP_DM_FOLLOW_UP';
