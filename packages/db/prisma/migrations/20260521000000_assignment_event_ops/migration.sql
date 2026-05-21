-- Migration: assignment_event_ops
-- Adds role eligibility rules, scheduled message jobs, seating groups,
-- signup preferences, backup DM lifecycle, assignment lock, and expanded
-- assignment statuses.  All new columns have safe defaults; no existing
-- data is destroyed or retyped.

-- ─── New enums ─────────────────────────────────────────────────────────────

CREATE TYPE "SignupRole" AS ENUM ('PLAYER', 'TABLE_DM', 'BACKUP_DM', 'AMBASSADOR');

CREATE TYPE "BackupDmStatus" AS ENUM (
    'BACKUP_AVAILABLE_AS_PLAYER',
    'BACKUP_ON_STANDBY',
    'BACKUP_PULL_PENDING',
    'BACKUP_PULLED_TO_DM',
    'BACKUP_RELEASED_AS_PLAYER',
    'BACKUP_DECLINED_PULL',
    'BACKUP_UNAVAILABLE'
);

CREATE TYPE "BackupPullMode" AS ENUM ('MANUAL', 'CONSENT_REQUIRED', 'AUTO');

CREATE TYPE "EventMessageType" AS ENUM ('PRE_EVENT', 'POST_EVENT', 'REMINDER', 'CUSTOM');

CREATE TYPE "MessageTargetType" AS ENUM ('CHANNEL', 'USER', 'ROLE');

CREATE TYPE "MessageJobStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED');

CREATE TYPE "SeatingGroupStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PARTIAL', 'DENIED');

CREATE TYPE "SplitPolicy" AS ENUM ('DO_NOT_SPLIT', 'SPLIT_IF_NEEDED', 'ORGANIZER_DECIDES');

CREATE TYPE "SeatingGroupMemberStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED');

CREATE TYPE "PreferenceType" AS ENUM ('PREFER_DM', 'AVOID_DM', 'PREFER_PLAYER', 'AVOID_PLAYER', 'NOTE');

CREATE TYPE "PreferenceStrength" AS ENUM ('SOFT', 'HARD');

-- ─── Extend AssignmentStatus with projected/confirmed values ───────────────
-- Additive only; existing values (ASSIGNED, WAITLISTED, etc.) are kept.

ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'PROJECTED_SEATED';
ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'PROJECTED_WAITLISTED';
ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED_SEATED';
ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED_DM';
ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED_WAITLISTED';
ALTER TYPE "AssignmentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- ─── Add columns to Event ──────────────────────────────────────────────────

ALTER TABLE "Event"
    ADD COLUMN "assignmentLockOffsetMinutes" INTEGER NOT NULL DEFAULT 120,
    ADD COLUMN "assignmentLockedAt"          TIMESTAMP(3),
    ADD COLUMN "backupPullMode"              "BackupPullMode" NOT NULL DEFAULT 'CONSENT_REQUIRED',
    ADD COLUMN "backupPullDeadline"          TIMESTAMP(3);

-- ─── Add columns to AmbassadorProfile ─────────────────────────────────────

ALTER TABLE "AmbassadorProfile"
    ADD COLUMN "lastDmDate"               TIMESTAMP(3),
    ADD COLUMN "dmCountLast30Days"        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "backupPullCountLast90Days" INTEGER NOT NULL DEFAULT 0;

-- ─── Add columns to RSVP ──────────────────────────────────────────────────

ALTER TABLE "RSVP"
    ADD COLUMN "signupRole" "SignupRole" NOT NULL DEFAULT 'PLAYER';

-- ─── Add columns to EventParticipant ──────────────────────────────────────

ALTER TABLE "EventParticipant"
    ADD COLUMN "signupRole"     "SignupRole",
    ADD COLUMN "backupDmStatus" "BackupDmStatus";

-- ─── Add columns to Assignment ────────────────────────────────────────────

ALTER TABLE "Assignment"
    ADD COLUMN "reasonCode" TEXT;

-- ─── Add columns to AuditLog ──────────────────────────────────────────────

ALTER TABLE "AuditLog"
    ADD COLUMN "reasonCode" TEXT;

-- ─── New table: EventMessageJob ────────────────────────────────────────────

CREATE TABLE "EventMessageJob" (
    "id"           TEXT                NOT NULL,
    "eventId"      TEXT                NOT NULL,
    "messageType"  "EventMessageType"  NOT NULL,
    "targetType"   "MessageTargetType" NOT NULL,
    "targetId"     TEXT                NOT NULL,
    "scheduledFor" TIMESTAMP(3)        NOT NULL,
    "status"       "MessageJobStatus"  NOT NULL DEFAULT 'PENDING',
    "sentAt"       TIMESTAMP(3),
    "failedAt"     TIMESTAMP(3),
    "lastError"    TEXT,
    "createdAt"    TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)        NOT NULL,

    CONSTRAINT "EventMessageJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventMessageJob_eventId_messageType_targetId_key"
    ON "EventMessageJob"("eventId", "messageType", "targetId");

CREATE INDEX "EventMessageJob_eventId_status_idx"
    ON "EventMessageJob"("eventId", "status");

CREATE INDEX "EventMessageJob_scheduledFor_status_idx"
    ON "EventMessageJob"("scheduledFor", "status");

ALTER TABLE "EventMessageJob"
    ADD CONSTRAINT "EventMessageJob_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── New table: EventEligibilityRule ──────────────────────────────────────

CREATE TABLE "EventEligibilityRule" (
    "id"                     TEXT         NOT NULL,
    "eventId"                TEXT         NOT NULL,
    "signupRole"             "SignupRole"  NOT NULL,
    "allowedDiscordRoleIds"  TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "requiredDiscordRoleIds" TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deniedDiscordRoleIds"   TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "requiresApproval"       BOOLEAN       NOT NULL DEFAULT false,
    "createdAt"              TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3)  NOT NULL,

    CONSTRAINT "EventEligibilityRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventEligibilityRule_eventId_signupRole_key"
    ON "EventEligibilityRule"("eventId", "signupRole");

CREATE INDEX "EventEligibilityRule_eventId_idx"
    ON "EventEligibilityRule"("eventId");

ALTER TABLE "EventEligibilityRule"
    ADD CONSTRAINT "EventEligibilityRule_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── New table: EventSeatingGroup ─────────────────────────────────────────

CREATE TABLE "EventSeatingGroup" (
    "id"                TEXT                 NOT NULL,
    "eventId"           TEXT                 NOT NULL,
    "groupCode"         TEXT                 NOT NULL,
    "requestedByUserId" TEXT                 NOT NULL,
    "status"            "SeatingGroupStatus" NOT NULL DEFAULT 'PENDING',
    "splitPolicy"       "SplitPolicy"        NOT NULL DEFAULT 'ORGANIZER_DECIDES',
    "maxSize"           INTEGER              NOT NULL DEFAULT 8,
    "createdAt"         TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "EventSeatingGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventSeatingGroup_groupCode_key"
    ON "EventSeatingGroup"("groupCode");

CREATE INDEX "EventSeatingGroup_eventId_idx"
    ON "EventSeatingGroup"("eventId");

CREATE INDEX "EventSeatingGroup_groupCode_idx"
    ON "EventSeatingGroup"("groupCode");

ALTER TABLE "EventSeatingGroup"
    ADD CONSTRAINT "EventSeatingGroup_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── New table: EventSeatingGroupMember ───────────────────────────────────

CREATE TABLE "EventSeatingGroupMember" (
    "id"        TEXT                      NOT NULL,
    "groupId"   TEXT                      NOT NULL,
    "userId"    TEXT                      NOT NULL,
    "status"    "SeatingGroupMemberStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3)              NOT NULL,

    CONSTRAINT "EventSeatingGroupMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventSeatingGroupMember_groupId_userId_key"
    ON "EventSeatingGroupMember"("groupId", "userId");

CREATE INDEX "EventSeatingGroupMember_groupId_idx"
    ON "EventSeatingGroupMember"("groupId");

ALTER TABLE "EventSeatingGroupMember"
    ADD CONSTRAINT "EventSeatingGroupMember_groupId_fkey"
    FOREIGN KEY ("groupId") REFERENCES "EventSeatingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── New table: EventSignupPreference ─────────────────────────────────────

CREATE TABLE "EventSignupPreference" (
    "id"             TEXT                 NOT NULL,
    "eventId"        TEXT                 NOT NULL,
    "userId"         TEXT                 NOT NULL,
    "preferenceType" "PreferenceType"     NOT NULL,
    "targetUserId"   TEXT,
    "note"           TEXT,
    "strength"       "PreferenceStrength" NOT NULL DEFAULT 'SOFT',
    "createdAt"      TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "EventSignupPreference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventSignupPreference_eventId_userId_idx"
    ON "EventSignupPreference"("eventId", "userId");

CREATE INDEX "EventSignupPreference_eventId_preferenceType_idx"
    ON "EventSignupPreference"("eventId", "preferenceType");

ALTER TABLE "EventSignupPreference"
    ADD CONSTRAINT "EventSignupPreference_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── New indexes on RSVP ──────────────────────────────────────────────────

CREATE INDEX "RSVP_eventId_signupRole_idx"
    ON "RSVP"("eventId", "signupRole");

-- ─── New indexes on EventParticipant ──────────────────────────────────────

CREATE INDEX "EventParticipant_eventId_signupRole_idx"
    ON "EventParticipant"("eventId", "signupRole");
