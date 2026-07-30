-- Add configurable shortage-alert offset to EventSeries and Event.
-- When set, overrides the 24h system default for the PREFLIGHT organizer DM.
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "shortageAlertHoursBefore" INTEGER;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "shortageAlertHoursBefore" INTEGER;
