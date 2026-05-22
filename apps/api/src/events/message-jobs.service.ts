import { Injectable, Logger } from "@nestjs/common";
import {
  computePreEventScheduledFor,
  computePostEventScheduledFor,
  computeReminderScheduledFor,
  computeBackupDmAskScheduledFor,
  computeAssignmentLockScheduledFor,
} from "@artemis/domain";
import { PrismaService } from "../prisma/prisma.service.js";

type EventForMessageJobs = {
  id: string;
  channelId: string;
  startAt: Date;
  endAt: Date;
  // createdByDiscordId targets the REMINDER DM to the event organizer (rules.md §12.4).
  createdByDiscordId: string;
};

@Injectable()
export class MessageJobsService {
  private readonly logger = new Logger(MessageJobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Called on event creation. Creates pending pre-event, post-event, T-4h
  // organizer reminder (DM to creator), T-3h backup DM ask, and T-1h
  // assignment lock jobs. Uses upsert so calling twice is idempotent.
  //
  // REMINDER targets the event creator via DM (not the public channel) per
  // rules.md §4.2, §12.4: organizer warnings must not be posted publicly.
  //
  // ASSIGNMENT_LOCK is a P0 requirement per rules.md §11.1: assignment must
  // run and lock exactly 1 hour before event start.
  async scheduleEventMessages(event: EventForMessageJobs): Promise<void> {
    const preScheduledFor = computePreEventScheduledFor(event.startAt);
    const postScheduledFor = computePostEventScheduledFor(event.endAt);
    const reminderScheduledFor = computeReminderScheduledFor(event.startAt);
    const backupDmAskScheduledFor = computeBackupDmAskScheduledFor(event.startAt);
    const assignmentLockScheduledFor = computeAssignmentLockScheduledFor(event.startAt);

    const upsertJob = (
      messageType: "PRE_EVENT" | "POST_EVENT" | "REMINDER" | "CUSTOM" | "ASSIGNMENT_LOCK",
      targetType: "CHANNEL" | "USER",
      targetId: string,
      scheduledFor: Date,
    ) =>
      this.prisma.client.eventMessageJob.upsert({
        where: { eventId_messageType_targetId: { eventId: event.id, messageType, targetId } },
        create: { eventId: event.id, messageType, targetType, targetId, scheduledFor, status: "PENDING" },
        update: { scheduledFor },
      });

    await this.prisma.client.$transaction([
      upsertJob("PRE_EVENT",       "CHANNEL", event.channelId,             preScheduledFor),
      upsertJob("POST_EVENT",      "CHANNEL", event.channelId,             postScheduledFor),
      // REMINDER goes to the event creator via DM — not the public channel.
      upsertJob("REMINDER",        "USER",    event.createdByDiscordId,    reminderScheduledFor),
      upsertJob("CUSTOM",          "CHANNEL", event.channelId,             backupDmAskScheduledFor),
      // ASSIGNMENT_LOCK triggers lockAssignments() at T-1h (P0).
      upsertJob("ASSIGNMENT_LOCK", "CHANNEL", event.channelId,             assignmentLockScheduledFor),
    ]);

    this.logger.log(
      `Scheduled 5 message jobs for event ${event.id}: ` +
      `reminder(DM)=${reminderScheduledFor.toISOString()} ` +
      `backupAsk=${backupDmAskScheduledFor.toISOString()} ` +
      `assignmentLock=${assignmentLockScheduledFor.toISOString()} ` +
      `pre=${preScheduledFor.toISOString()} ` +
      `post=${postScheduledFor.toISOString()}`,
    );
  }

  // Called on event update when startAt or endAt changes.
  // Only reschedules PENDING jobs; already-sent or failed jobs are not touched.
  async rescheduleEventMessages(event: EventForMessageJobs): Promise<void> {
    const preScheduledFor = computePreEventScheduledFor(event.startAt);
    const postScheduledFor = computePostEventScheduledFor(event.endAt);
    const reminderScheduledFor = computeReminderScheduledFor(event.startAt);
    const backupDmAskScheduledFor = computeBackupDmAskScheduledFor(event.startAt);
    const assignmentLockScheduledFor = computeAssignmentLockScheduledFor(event.startAt);

    const updatePending = (
      messageType: "PRE_EVENT" | "POST_EVENT" | "REMINDER" | "CUSTOM" | "ASSIGNMENT_LOCK",
      scheduledFor: Date,
    ) =>
      this.prisma.client.eventMessageJob.updateMany({
        where: { eventId: event.id, messageType, status: "PENDING" },
        data: { scheduledFor },
      });

    await this.prisma.client.$transaction([
      updatePending("PRE_EVENT",       preScheduledFor),
      updatePending("POST_EVENT",      postScheduledFor),
      updatePending("REMINDER",        reminderScheduledFor),
      updatePending("CUSTOM",          backupDmAskScheduledFor),
      updatePending("ASSIGNMENT_LOCK", assignmentLockScheduledFor),
    ]);

    this.logger.log(`Rescheduled PENDING message jobs for event ${event.id}`);
  }

  // Cancel all pending jobs for a cancelled event.
  async cancelEventMessages(eventId: string): Promise<void> {
    await this.prisma.client.eventMessageJob.updateMany({
      where: { eventId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }

  // Mark a job as sent. Called by the job worker after successful delivery.
  async markSent(jobId: string): Promise<void> {
    await this.prisma.client.eventMessageJob.update({
      where: { id: jobId },
      data: { status: "SENT", sentAt: new Date() },
    });
  }

  // Mark a job as failed with a stored error message.
  // Jobs must never silently fail — the error is always persisted.
  async markFailed(jobId: string, error: string): Promise<void> {
    await this.prisma.client.eventMessageJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        lastError: error.slice(0, 2000),
      },
    });
    this.logger.error(`Message job ${jobId} failed: ${error}`);
  }

  // List all message jobs for an event (admin-visible observable state).
  async listForEvent(eventId: string) {
    return this.prisma.client.eventMessageJob.findMany({
      where: { eventId },
      orderBy: { scheduledFor: "asc" },
    });
  }

  // Process any pending jobs whose scheduledFor time has passed.
  // In production this would be called by a pg-boss worker; exposed here
  // so it can be triggered manually or in tests.
  async processDueJobs(
    sender: (job: { id: string; messageType: string; targetId: string; eventId: string }) => Promise<void>,
  ): Promise<{ processed: number; failed: number }> {
    const due = await this.prisma.client.eventMessageJob.findMany({
      where: {
        status: "PENDING",
        scheduledFor: { lte: new Date() },
      },
      orderBy: { scheduledFor: "asc" },
      take: 50,
    });

    let processed = 0;
    let failed = 0;

    for (const job of due) {
      try {
        await sender(job);
        await this.markSent(job.id);
        processed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.markFailed(job.id, message);
        failed++;
      }
    }

    return { processed, failed };
  }
}
