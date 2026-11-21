-- F03: stable series occurrence identity and generation-request idempotency.

ALTER TABLE "Event" ADD COLUMN "occurrenceKey" TEXT;

-- Backfill existing series occurrences with the local date of their current
-- start time in the guild timezone (the original slot of an already-moved
-- event is not recoverable). If two occurrences of one series share a date,
-- only the earliest-created gets the key; the others stay NULL so nothing is
-- discarded and the unique index can be created. They remain normal events.
WITH keyed AS (
  SELECT e."id",
         to_char((e."startAt" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(gs."defaultTimezone", 'America/New_York'),
                 'YYYY-MM-DD') AS key,
         e."seriesId",
         e."createdAt"
  FROM "Event" e
  LEFT JOIN "GuildSettings" gs ON gs."guildId" = e."guildId"
  WHERE e."seriesId" IS NOT NULL
),
ranked AS (
  SELECT "id", key,
         ROW_NUMBER() OVER (PARTITION BY "seriesId", key ORDER BY "createdAt", "id") AS rn
  FROM keyed
)
UPDATE "Event" e
SET "occurrenceKey" = ranked.key
FROM ranked
WHERE e."id" = ranked."id" AND ranked.rn = 1;

CREATE UNIQUE INDEX "Event_seriesId_occurrenceKey_key" ON "Event"("seriesId", "occurrenceKey");

CREATE TABLE "SeriesGenerationRequest" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SeriesGenerationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeriesGenerationRequest_seriesId_requestId_key" ON "SeriesGenerationRequest"("seriesId", "requestId");

ALTER TABLE "SeriesGenerationRequest" ADD CONSTRAINT "SeriesGenerationRequest_seriesId_fkey"
  FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
