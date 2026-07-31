-- Add per-participant assignment notification job types so each delivery is
-- durable and retryable rather than fire-and-forget from the cron worker.
ALTER TYPE "EventMessageType" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_SEATED';
ALTER TYPE "EventMessageType" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_WAITLISTED';

-- Add PROCESSING status so job workers can atomically claim a job before
-- executing it, preventing double-dispatch under concurrent polling.
ALTER TYPE "MessageJobStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

-- Partial unique index on (seriesId, startAt) enforces at the DB level that
-- no two events in the same series share the same start time.  The WHERE
-- clause excludes one-off events (seriesId IS NULL) so their startAt values
-- are never constrained relative to one another.
CREATE UNIQUE INDEX IF NOT EXISTS "Event_seriesId_startAt_key"
  ON "Event" ("seriesId", "startAt")
  WHERE "seriesId" IS NOT NULL;
