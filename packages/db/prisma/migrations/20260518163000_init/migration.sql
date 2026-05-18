-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SIGNUP_OPEN', 'SIGNUP_CLOSED', 'LOCKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlayerCategory" AS ENUM ('NORMAL', 'HEROIC', 'MIXED');

-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('PRIMARY', 'GUEST', 'WALK_IN');

-- CreateEnum
CREATE TYPE "RSVPStatus" AS ENUM ('GOING', 'CANCELLED', 'WAITLISTED', 'REMOVED');

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('OPEN', 'FULL', 'LOCKED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'WAITLISTED', 'UNASSIGNED', 'REMOVED', 'MOVED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('ATTENDED', 'NO_SHOW', 'WALK_IN', 'EXCUSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('PENDING', 'SENT', 'OPENED', 'SUBMITTED', 'EXPIRED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EventRoleType" AS ENUM ('PLAYER', 'AMBASSADOR');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "GuildSettings" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "staffRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "adminRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ambassadorRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "normalRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "heroicRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultEventChannelId" TEXT,
    "feedbackFormUrl" TEXT,
    "temporaryRoleCleanupDays" INTEGER NOT NULL DEFAULT 14,
    "attendanceReminderHours" INTEGER[] DEFAULT ARRAY[24, 48]::INTEGER[],
    "autoCloseAfterHours" INTEGER NOT NULL DEFAULT 72,
    "databaseConnectionLimit" INTEGER NOT NULL DEFAULT 25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requiresRsvp" BOOLEAN NOT NULL DEFAULT true,
    "allowsGuests" BOOLEAN NOT NULL DEFAULT true,
    "maxGuestsPerRsvp" INTEGER NOT NULL DEFAULT 3,
    "requiresAmbassadors" BOOLEAN NOT NULL DEFAULT true,
    "requiresTableAssignment" BOOLEAN NOT NULL DEFAULT true,
    "usesPlayerCategories" BOOLEAN NOT NULL DEFAULT true,
    "createsTemporaryRoles" BOOLEAN NOT NULL DEFAULT true,
    "requiresAttendanceConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "sendsFeedbackPrompts" BOOLEAN NOT NULL DEFAULT true,
    "usesWaitlist" BOOLEAN NOT NULL DEFAULT true,
    "allowsNameOnlyWalkIns" BOOLEAN NOT NULL DEFAULT true,
    "defaultGameSystem" TEXT NOT NULL DEFAULT 'D&D',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultChannelId" TEXT NOT NULL,
    "recurrenceRule" TEXT NOT NULL,
    "signupOpenHoursBefore" INTEGER NOT NULL DEFAULT 168,
    "signupCloseHoursBefore" INTEGER NOT NULL DEFAULT 1,
    "defaultRoleCleanupDays" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "seriesId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "gameSystem" TEXT NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "signupOpensAt" TIMESTAMP(3),
    "signupClosesAt" TIMESTAMP(3),
    "roleCleanupAt" TIMESTAMP(3),
    "feedbackWindowHours" INTEGER NOT NULL DEFAULT 72,
    "assignmentNotifiedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdByDiscordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbassadorProfile" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "supportedEventKeys" TEXT[] DEFAULT ARRAY['dnd_session_night']::TEXT[],
    "supportedGameSystems" TEXT[] DEFAULT ARRAY['D&D']::TEXT[],
    "defaultSoftCap" INTEGER NOT NULL DEFAULT 6,
    "defaultHardCap" INTEGER NOT NULL DEFAULT 7,
    "defaultTableType" "PlayerCategory" NOT NULL DEFAULT 'MIXED',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbassadorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "preferredName" TEXT,
    "characterName" TEXT,
    "defaultCategory" "PlayerCategory" NOT NULL DEFAULT 'NORMAL',
    "roleDetectedCategory" "PlayerCategory",
    "manualOverrideCategory" "PlayerCategory",
    "staffNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventTable" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ambassadorProfileId" TEXT,
    "title" TEXT NOT NULL,
    "tableType" "PlayerCategory" NOT NULL DEFAULT 'MIXED',
    "softCap" INTEGER NOT NULL DEFAULT 6,
    "hardCap" INTEGER NOT NULL DEFAULT 7,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "TableStatus" NOT NULL DEFAULT 'OPEN',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RSVP" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "primaryDiscordUserId" TEXT NOT NULL,
    "playerProfileId" TEXT,
    "selectedCategory" "PlayerCategory" NOT NULL DEFAULT 'NORMAL',
    "status" "RSVPStatus" NOT NULL DEFAULT 'GOING',
    "partyKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'discord',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RSVP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "rsvpId" TEXT,
    "playerProfileId" TEXT,
    "participantType" "ParticipantType" NOT NULL,
    "discordUserId" TEXT,
    "enteredName" TEXT,
    "displayName" TEXT NOT NULL,
    "preferredName" TEXT,
    "characterName" TEXT,
    "playerCategory" "PlayerCategory" NOT NULL DEFAULT 'NORMAL',
    "partyKey" TEXT NOT NULL,
    "partyOwnerParticipantId" TEXT,
    "feedbackEligible" BOOLEAN NOT NULL DEFAULT true,
    "messageEligible" BOOLEAN NOT NULL DEFAULT true,
    "roleEligible" BOOLEAN NOT NULL DEFAULT true,
    "attendanceEligible" BOOLEAN NOT NULL DEFAULT true,
    "assignmentEligible" BOOLEAN NOT NULL DEFAULT true,
    "confirmationStatus" "AttendanceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "createdByDiscordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventParticipantId" TEXT NOT NULL,
    "eventTableId" TEXT,
    "status" "AssignmentStatus" NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventTableId" TEXT,
    "eventParticipantId" TEXT NOT NULL,
    "rsvpId" TEXT,
    "status" "AttendanceStatus" NOT NULL,
    "confirmedByDiscordId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'discord',
    "notes" TEXT,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackRequest" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventTableId" TEXT,
    "eventParticipantId" TEXT NOT NULL,
    "ambassadorProfileId" TEXT,
    "attendanceRecordId" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'PENDING',
    "feedbackUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "FeedbackRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRole" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "roleType" "EventRoleType" NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "EventRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "recipientUserId" TEXT,
    "channelId" TEXT,
    "type" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "eventId" TEXT,
    "actorDiscordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerPreference" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerDiscordUserId" TEXT NOT NULL,
    "preferredDiscordUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "avoidDiscordUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tableStyleTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staffOnlyNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildSettings_guildId_key" ON "GuildSettings"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "EventType_key_key" ON "EventType"("key");

-- CreateIndex
CREATE INDEX "EventSeries_guildId_eventTypeId_idx" ON "EventSeries"("guildId", "eventTypeId");

-- CreateIndex
CREATE INDEX "Event_guildId_startAt_idx" ON "Event"("guildId", "startAt");

-- CreateIndex
CREATE INDEX "Event_status_startAt_idx" ON "Event"("status", "startAt");

-- CreateIndex
CREATE INDEX "AmbassadorProfile_guildId_active_idx" ON "AmbassadorProfile"("guildId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "AmbassadorProfile_guildId_discordUserId_key" ON "AmbassadorProfile"("guildId", "discordUserId");

-- CreateIndex
CREATE INDEX "PlayerProfile_guildId_displayName_idx" ON "PlayerProfile"("guildId", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_guildId_discordUserId_key" ON "PlayerProfile"("guildId", "discordUserId");

-- CreateIndex
CREATE INDEX "EventTable_eventId_status_idx" ON "EventTable"("eventId", "status");

-- CreateIndex
CREATE INDEX "RSVP_eventId_status_idx" ON "RSVP"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RSVP_eventId_primaryDiscordUserId_key" ON "RSVP"("eventId", "primaryDiscordUserId");

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_participantType_idx" ON "EventParticipant"("eventId", "participantType");

-- CreateIndex
CREATE INDEX "EventParticipant_eventId_partyKey_idx" ON "EventParticipant"("eventId", "partyKey");

-- CreateIndex
CREATE INDEX "EventParticipant_discordUserId_idx" ON "EventParticipant"("discordUserId");

-- CreateIndex
CREATE INDEX "Assignment_eventId_status_idx" ON "Assignment"("eventId", "status");

-- CreateIndex
CREATE INDEX "Assignment_eventTableId_status_idx" ON "Assignment"("eventTableId", "status");

-- CreateIndex
CREATE INDEX "AttendanceRecord_eventId_status_idx" ON "AttendanceRecord"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_eventId_eventParticipantId_key" ON "AttendanceRecord"("eventId", "eventParticipantId");

-- CreateIndex
CREATE INDEX "FeedbackRequest_eventId_status_idx" ON "FeedbackRequest"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EventRole_eventId_roleType_key" ON "EventRole"("eventId", "roleType");

-- CreateIndex
CREATE UNIQUE INDEX "EventRole_discordRoleId_key" ON "EventRole"("discordRoleId");

-- CreateIndex
CREATE INDEX "NotificationLog_eventId_status_idx" ON "NotificationLog"("eventId", "status");

-- CreateIndex
CREATE INDEX "NotificationLog_status_createdAt_idx" ON "NotificationLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_eventId_createdAt_idx" ON "AuditLog"("eventId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerPreference_guildId_playerDiscordUserId_key" ON "PlayerPreference"("guildId", "playerDiscordUserId");

-- AddForeignKey
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "EventSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTable" ADD CONSTRAINT "EventTable_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventTable" ADD CONSTRAINT "EventTable_ambassadorProfileId_fkey" FOREIGN KEY ("ambassadorProfileId") REFERENCES "AmbassadorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RSVP" ADD CONSTRAINT "RSVP_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "RSVP"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_playerProfileId_fkey" FOREIGN KEY ("playerProfileId") REFERENCES "PlayerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_partyOwnerParticipantId_fkey" FOREIGN KEY ("partyOwnerParticipantId") REFERENCES "EventParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_eventParticipantId_fkey" FOREIGN KEY ("eventParticipantId") REFERENCES "EventParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_eventTableId_fkey" FOREIGN KEY ("eventTableId") REFERENCES "EventTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_eventTableId_fkey" FOREIGN KEY ("eventTableId") REFERENCES "EventTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_eventParticipantId_fkey" FOREIGN KEY ("eventParticipantId") REFERENCES "EventParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRequest" ADD CONSTRAINT "FeedbackRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRequest" ADD CONSTRAINT "FeedbackRequest_eventTableId_fkey" FOREIGN KEY ("eventTableId") REFERENCES "EventTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRequest" ADD CONSTRAINT "FeedbackRequest_eventParticipantId_fkey" FOREIGN KEY ("eventParticipantId") REFERENCES "EventParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackRequest" ADD CONSTRAINT "FeedbackRequest_ambassadorProfileId_fkey" FOREIGN KEY ("ambassadorProfileId") REFERENCES "AmbassadorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRole" ADD CONSTRAINT "EventRole_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

