-- Add durable per-participant assignment notification job types.
-- ASSIGNMENT_SEATED: participant confirmed to a table (replaces fire-and-forget DM).
-- ASSIGNMENT_WAITLISTED: participant on the waitlist after lock.
ALTER TYPE "EventMessageType" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_SEATED';
ALTER TYPE "EventMessageType" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_WAITLISTED';
