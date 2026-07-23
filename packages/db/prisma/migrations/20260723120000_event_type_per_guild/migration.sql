-- EventType becomes guild-scoped so multiple Discord guilds can share one deployment
-- without sharing (or fighting over) the same event-type catalog.

ALTER TABLE "EventType" ADD COLUMN IF NOT EXISTS "guildId" TEXT;

-- Backfill from any Event already referencing this EventType (most authoritative source).
UPDATE "EventType" et
SET "guildId" = sub."guildId"
FROM (
  SELECT DISTINCT ON ("eventTypeId") "eventTypeId", "guildId"
  FROM "Event"
  ORDER BY "eventTypeId", "createdAt" ASC
) sub
WHERE et."id" = sub."eventTypeId" AND et."guildId" IS NULL;

-- Backfill any still-unmatched rows from EventSeries.
UPDATE "EventType" et
SET "guildId" = sub."guildId"
FROM (
  SELECT DISTINCT ON ("eventTypeId") "eventTypeId", "guildId"
  FROM "EventSeries"
  ORDER BY "eventTypeId", "createdAt" ASC
) sub
WHERE et."id" = sub."eventTypeId" AND et."guildId" IS NULL;

-- Any EventType rows still unmatched (not yet used by an Event/EventSeries) fall back to the
-- single guild configured on this deployment prior to multi-guild support, if one exists.
UPDATE "EventType"
SET "guildId" = (SELECT "guildId" FROM "GuildSettings" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "guildId" IS NULL
  AND EXISTS (SELECT 1 FROM "GuildSettings");

-- Anything still unmatched (fresh/empty database with no guild data at all) is meaningless
-- without an owning guild; drop it rather than leave orphaned rows.
DELETE FROM "EventType" WHERE "guildId" IS NULL;

ALTER TABLE "EventType" ALTER COLUMN "guildId" SET NOT NULL;

DROP INDEX IF EXISTS "EventType_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EventType_guildId_key_key" ON "EventType"("guildId", "key");
CREATE INDEX IF NOT EXISTS "EventType_guildId_idx" ON "EventType"("guildId");
