-- F04: Discord desired/applied membership state, safe role cleanup, publish lease.

CREATE TYPE "DiscordSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

ALTER TABLE "Event" ADD COLUMN "publishLockUntil" TIMESTAMP(3);

ALTER TABLE "EventRole"
  ADD COLUMN "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cleanupNextAttemptAt" TIMESTAMP(3);

CREATE TABLE "EventDiscordMembership" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "desired" BOOLEAN NOT NULL,
    "status" "DiscordSyncStatus" NOT NULL DEFAULT 'PENDING',
    "roleApplied" BOOLEAN NOT NULL DEFAULT false,
    "threadApplied" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventDiscordMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventDiscordMembership_eventId_discordUserId_key" ON "EventDiscordMembership"("eventId", "discordUserId");
CREATE INDEX "EventDiscordMembership_status_nextAttemptAt_idx" ON "EventDiscordMembership"("status", "nextAttemptAt");

ALTER TABLE "EventDiscordMembership" ADD CONSTRAINT "EventDiscordMembership_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill desired access for upcoming, non-cancelled events: everyone with an
-- active primary RSVP. They start PENDING so the reconciler converges them
-- (adding missing thread members from before thread creation, for example).
INSERT INTO "EventDiscordMembership" ("id", "eventId", "discordUserId", "desired", "status", "updatedAt")
SELECT 'bf_' || md5(r."eventId" || ':' || r."primaryDiscordUserId"), r."eventId", r."primaryDiscordUserId", true, 'PENDING', CURRENT_TIMESTAMP
FROM "RSVP" r
JOIN "Event" e ON e."id" = r."eventId"
WHERE r."status" IN ('GOING', 'WAITLISTED')
  AND e."status" NOT IN ('CANCELLED', 'ARCHIVED', 'COMPLETED')
  AND e."endAt" > CURRENT_TIMESTAMP
ON CONFLICT ("eventId", "discordUserId") DO NOTHING;
