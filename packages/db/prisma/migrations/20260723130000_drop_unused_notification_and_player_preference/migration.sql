-- Drop NotificationLog and PlayerPreference: both were fully unused schema (zero
-- application code references EventMessageJob is the actual notification-delivery
-- tracking model in use; EventSignupPreference is the actual player preference model).

ALTER TABLE "NotificationLog" DROP CONSTRAINT IF EXISTS "NotificationLog_eventId_fkey";
DROP TABLE IF EXISTS "NotificationLog";
DROP TYPE IF EXISTS "NotificationStatus";

DROP TABLE IF EXISTS "PlayerPreference";
