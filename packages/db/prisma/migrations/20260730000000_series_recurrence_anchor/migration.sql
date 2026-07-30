-- Persist the biweekly recurrence anchor on the series itself instead of
-- deriving it from the earliest generated event, which is mutable
-- (deletable/reschedulable) and therefore an unstable cadence reference.
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "recurrenceAnchorAt" TIMESTAMP(3);
