-- Add persistent Campaign model and optional campaign FK on EventTable and RSVP.
-- Campaigns span multiple event occurrences; players who RSVP with a campaignId
-- get continuity-priority seating when the same campaign's table runs next session.

CREATE TABLE IF NOT EXISTS "Campaign" (
  "id"              TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "guildId"         TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT,
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
  "dmDiscordUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Campaign_guildId_status_idx" ON "Campaign"("guildId", "status");

ALTER TABLE "EventTable" ADD COLUMN IF NOT EXISTS "campaignId" TEXT REFERENCES "Campaign"("id") ON DELETE SET NULL;
ALTER TABLE "RSVP"       ADD COLUMN IF NOT EXISTS "campaignId" TEXT REFERENCES "Campaign"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "EventTable_campaignId_idx" ON "EventTable"("campaignId");
CREATE INDEX IF NOT EXISTS "RSVP_campaignId_idx" ON "RSVP"("campaignId");
