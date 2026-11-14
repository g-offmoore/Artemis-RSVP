-- Default-only change: existing event policies (including legacy 120) are preserved.
ALTER TABLE "Event" ALTER COLUMN "assignmentLockOffsetMinutes" SET DEFAULT 60;
