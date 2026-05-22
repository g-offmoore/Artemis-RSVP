-- Add ASSIGNMENT_LOCK to EventMessageType enum.
-- This enables scheduling an assignment-lock job exactly 1 hour before
-- event start, which is a P0 requirement (rules.md §11.1, §11.2).
ALTER TYPE "EventMessageType" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_LOCK';
