-- F01: make the per-event assignment-lock offset an explicit, nullable override.
-- The previous NOT NULL DEFAULT 120 column was never read by any code path; every
-- event has always locked at the canonical T-60 default. Clearing the stored 120s
-- preserves that effective behavior instead of silently moving locks to T-120.
ALTER TABLE "Event" ALTER COLUMN "assignmentLockOffsetMinutes" DROP DEFAULT;
ALTER TABLE "Event" ALTER COLUMN "assignmentLockOffsetMinutes" DROP NOT NULL;
UPDATE "Event" SET "assignmentLockOffsetMinutes" = NULL WHERE "assignmentLockOffsetMinutes" = 120;
