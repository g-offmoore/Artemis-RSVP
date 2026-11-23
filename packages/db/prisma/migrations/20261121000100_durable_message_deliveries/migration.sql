-- F02: durable at-least-once message delivery with logical dedupe, leases and retries.

ALTER TYPE "MessageJobStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "EventMessageJob"
  ADD COLUMN "deliveryKey" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "remoteMessageId" TEXT;

-- Backfill: existing rows were unique on (eventId, messageType, targetId), so the
-- legacy key is collision-free.
UPDATE "EventMessageJob"
SET "deliveryKey" = "eventId" || ':' || "messageType"::text || ':' || "targetId"
WHERE "deliveryKey" IS NULL;

-- Rows already SENT/FAILED count as one attempt for observability.
UPDATE "EventMessageJob" SET "attempts" = 1 WHERE "status" IN ('SENT', 'FAILED');

ALTER TABLE "EventMessageJob" ALTER COLUMN "deliveryKey" SET NOT NULL;
CREATE UNIQUE INDEX "EventMessageJob_deliveryKey_key" ON "EventMessageJob"("deliveryKey");

-- The old triple is no longer a uniqueness rule (several reminders or lock
-- revisions may target one user), but stays indexed for lookups.
DROP INDEX "EventMessageJob_eventId_messageType_targetId_key";
CREATE INDEX "EventMessageJob_eventId_messageType_targetId_idx" ON "EventMessageJob"("eventId", "messageType", "targetId");
CREATE INDEX "EventMessageJob_status_leaseExpiresAt_idx" ON "EventMessageJob"("status", "leaseExpiresAt");
