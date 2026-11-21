import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  computePreEventScheduledFor,
  computePostEventScheduledFor,
  computePreflightScheduledFor,
  computeReminderScheduledFor,
  computeBackupDmAskScheduledFor,
  computeAssignmentLockScheduledFor,
  DELIVERY_DEFAULTS,
  legacyDeliveryKey,
  nextDeliveryState,
} from "@artemis/domain";
import { PrismaService } from "../prisma/prisma.service.js";

type MessageType =
  | "PRE_EVENT"
  | "POST_EVENT"
  | "PREFLIGHT"
  | "REMINDER"
  | "CUSTOM"
  | "ASSIGNMENT_LOCK"
  | "BACKUP_DM_FOLLOW_UP"
  | "ASSIGNMENT_SEATED"
  | "ASSIGNMENT_WAITLISTED";

type EventForMessageJobs = {
  id: string;
  channelId: string;
  startAt: Date;
  endAt: Date;
  // createdByDiscordId targets the REMINDER DM to the event organizer (rules.md §12.4).
  createdByDiscordId: string;
  // When set, the PREFLIGHT alert fires this many hours before startAt instead of 24h.
  shortageAlertHoursBefore: number | null;
  // Per-event lock override in minutes; null uses the canonical T-1h default.
  assignmentLockOffsetMinutes?: number | null;
};

export type ClaimedJob = {
  id: string;
  eventId: string;
  messageType: string;
  targetId: string;
  deliveryKey: string;
  attempts: number;
  maxAttempts: number;
};

// Thrown by a dispatcher when a delivery should no longer be sent (event
// cancelled, recipient no longer participating, revision superseded). The job
// is marked SKIPPED with the reason instead of being retried or failed.
export class SkipDeliveryError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SkipDeliveryError";
  }
}

// Delivery model (F02): durable at-least-once processing with logical dedupe
// on `deliveryKey`. Exactly-once Discord delivery is not promised: if a worker
// crashes after Discord accepts a message but before SENT is persisted, the
// lease expires and the message may be sent again.
@Injectable()
export class MessageJobsService {
  private readonly logger = new Logger(MessageJobsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Called on event creation. Creates pending pre-event, post-event, T-24h
  // preflight (DM to creator), T-4h organizer reminder (DM to creator), T-3h
  // backup DM ask, and assignment lock jobs. Upserts on deliveryKey so calling
  // twice is idempotent.
  //
  // PREFLIGHT and REMINDER target the event creator via DM (not the public
  // channel) per rules.md §4.2, §12.4: organizer warnings must not be posted
  // publicly.
  //
  // ASSIGNMENT_LOCK is a P0 requirement per rules.md §11.1. Its time comes from
  // the canonical lock policy in @artemis/domain (T-1h unless overridden).
  async scheduleEventMessages(event: EventForMessageJobs): Promise<void> {
    const preScheduledFor = computePreEventScheduledFor(event.startAt);
    const postScheduledFor = computePostEventScheduledFor(event.endAt);
    const preflightScheduledFor = computePreflightScheduledFor(event.startAt, event.shortageAlertHoursBefore);
    const reminderScheduledFor = computeReminderScheduledFor(event.startAt);
    const backupDmAskScheduledFor = computeBackupDmAskScheduledFor(event.startAt);
    const assignmentLockScheduledFor = computeAssignmentLockScheduledFor(event.startAt, event.assignmentLockOffsetMinutes);

    const upsertJob = (
      messageType: MessageType,
      targetType: "CHANNEL" | "USER",
      targetId: string,
      scheduledFor: Date,
    ) => {
      const deliveryKey = legacyDeliveryKey(event.id, messageType, targetId);
      return this.prisma.client.eventMessageJob.upsert({
        where: { deliveryKey },
        create: { deliveryKey, eventId: event.id, messageType, targetType, targetId, scheduledFor, status: "PENDING" },
        update: { scheduledFor },
      });
    };

    await this.prisma.client.$transaction([
      upsertJob("PRE_EVENT",       "CHANNEL", event.channelId,             preScheduledFor),
      upsertJob("POST_EVENT",      "CHANNEL", event.channelId,             postScheduledFor),
      // PREFLIGHT and REMINDER go to the event creator via DM — not the public channel.
      upsertJob("PREFLIGHT",       "USER",    event.createdByDiscordId,    preflightScheduledFor),
      upsertJob("REMINDER",        "USER",    event.createdByDiscordId,    reminderScheduledFor),
      upsertJob("CUSTOM",          "CHANNEL", event.channelId,             backupDmAskScheduledFor),
      upsertJob("ASSIGNMENT_LOCK", "CHANNEL", event.channelId,             assignmentLockScheduledFor),
    ]);

    this.logger.log(
      `Scheduled 6 message jobs for event ${event.id}: ` +
      `preflight(DM)=${preflightScheduledFor.toISOString()} ` +
      `reminder(DM)=${reminderScheduledFor.toISOString()} ` +
      `backupAsk=${backupDmAskScheduledFor.toISOString()} ` +
      `assignmentLock=${assignmentLockScheduledFor.toISOString()} ` +
      `pre=${preScheduledFor.toISOString()} ` +
      `post=${postScheduledFor.toISOString()}`,
    );
  }

  // Called on event update when startAt, endAt, or an offset changes.
  // Only reschedules PENDING jobs; sent, failed, or in-flight jobs are not touched.
  // A pending retry backoff is cleared because the new time supersedes it.
  async rescheduleEventMessages(event: EventForMessageJobs): Promise<void> {
    const preScheduledFor = computePreEventScheduledFor(event.startAt);
    const postScheduledFor = computePostEventScheduledFor(event.endAt);
    const preflightScheduledFor = computePreflightScheduledFor(event.startAt, event.shortageAlertHoursBefore);
    const reminderScheduledFor = computeReminderScheduledFor(event.startAt);
    const backupDmAskScheduledFor = computeBackupDmAskScheduledFor(event.startAt);
    const assignmentLockScheduledFor = computeAssignmentLockScheduledFor(event.startAt, event.assignmentLockOffsetMinutes);

    const updatePending = (messageType: MessageType, scheduledFor: Date) =>
      this.prisma.client.eventMessageJob.updateMany({
        where: { eventId: event.id, messageType, status: "PENDING" },
        data: { scheduledFor, nextAttemptAt: null },
      });

    await this.prisma.client.$transaction([
      updatePending("PRE_EVENT",       preScheduledFor),
      updatePending("POST_EVENT",      postScheduledFor),
      updatePending("PREFLIGHT",       preflightScheduledFor),
      updatePending("REMINDER",        reminderScheduledFor),
      updatePending("CUSTOM",          backupDmAskScheduledFor),
      updatePending("ASSIGNMENT_LOCK", assignmentLockScheduledFor),
    ]);

    this.logger.log(`Rescheduled PENDING message jobs for event ${event.id}`);
  }

  // Schedule a single one-off delivery (e.g. BACKUP_DM_FOLLOW_UP). Idempotent on
  // deliveryKey: scheduling the same delivery twice moves a still-PENDING job
  // instead of duplicating it, and never re-arms a delivery that already ran.
  async scheduleJob(params: {
    eventId: string;
    messageType: MessageType;
    targetType: "CHANNEL" | "USER" | "ROLE";
    targetId: string;
    scheduledFor: Date;
    deliveryKey?: string;
  }): Promise<void> {
    const deliveryKey =
      params.deliveryKey ?? legacyDeliveryKey(params.eventId, params.messageType, params.targetId);

    const { count } = await this.prisma.client.eventMessageJob.updateMany({
      where: { deliveryKey, status: "PENDING" },
      data: { scheduledFor: params.scheduledFor, nextAttemptAt: null },
    });
    if (count > 0) return;

    await this.prisma.client.eventMessageJob.createMany({
      data: [{
        deliveryKey,
        eventId: params.eventId,
        messageType: params.messageType,
        targetType: params.targetType,
        targetId: params.targetId,
        scheduledFor: params.scheduledFor,
        status: "PENDING",
      }],
      skipDuplicates: true,
    });
  }

  // Cancel all pending jobs for a cancelled event. In-flight (PROCESSING) jobs
  // are caught by the dispatcher's cancellation recheck instead.
  async cancelEventMessages(eventId: string): Promise<void> {
    await this.prisma.client.eventMessageJob.updateMany({
      where: { eventId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }

  // Mark a job as sent. Conditional on still holding the lease so a worker
  // whose lease expired cannot overwrite a newer owner's outcome.
  async markSent(jobId: string, leaseOwner?: string, remoteMessageId?: string): Promise<void> {
    await this.prisma.client.eventMessageJob.updateMany({
      where: { id: jobId, ...(leaseOwner ? { leaseOwner } : {}) },
      data: {
        status: "SENT",
        sentAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        ...(remoteMessageId ? { remoteMessageId } : {}),
      },
    });
  }

  // Mark a job as skipped (event cancelled, recipient gone, revision superseded).
  async markSkipped(jobId: string, reason: string, leaseOwner?: string): Promise<void> {
    await this.prisma.client.eventMessageJob.updateMany({
      where: { id: jobId, ...(leaseOwner ? { leaseOwner } : {}) },
      data: { status: "SKIPPED", lastError: reason.slice(0, 2000), leaseOwner: null, leaseExpiresAt: null },
    });
  }

  // Record a failed attempt: schedule a retry with backoff, or mark FAILED for
  // terminal errors (blocked DMs, missing channels) and exhausted attempts.
  // Jobs never fail silently — the sanitized error is always persisted.
  async markFailed(
    jobId: string,
    error: unknown,
    attempt?: { attempts: number; maxAttempts: number; leaseOwner?: string },
  ): Promise<"RETRY" | "FAILED"> {
    const outcome = attempt
      ? nextDeliveryState(attempt.attempts, attempt.maxAttempts, error)
      : nextDeliveryState(1, 1, error);
    const where = { id: jobId, ...(attempt?.leaseOwner ? { leaseOwner: attempt.leaseOwner } : {}) };

    if (outcome.status === "PENDING") {
      await this.prisma.client.eventMessageJob.updateMany({
        where,
        data: {
          status: "PENDING",
          nextAttemptAt: outcome.nextAttemptAt,
          lastError: outcome.lastError,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      this.logger.warn(
        `Message job ${jobId} attempt failed; retry at ${outcome.nextAttemptAt.toISOString()}: ${outcome.lastError}`,
      );
      return "RETRY";
    }

    await this.prisma.client.eventMessageJob.updateMany({
      where,
      data: {
        status: "FAILED",
        failedAt: new Date(),
        lastError: outcome.lastError,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    this.logger.error(`Message job ${jobId} failed: ${outcome.lastError}`);
    return "FAILED";
  }

  // Staff retry of a FAILED or SKIPPED delivery: re-arm it for immediate dispatch.
  // Scoped to the event so a caller cannot re-arm another guild's job.
  async retryJob(eventId: string, jobId: string): Promise<{ ok: boolean }> {
    const { count } = await this.prisma.client.eventMessageJob.updateMany({
      where: { id: jobId, eventId, status: { in: ["FAILED", "SKIPPED"] } },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: null, failedAt: null },
    });
    return { ok: count === 1 };
  }

  // List all message jobs for an event (admin-visible observable state).
  async listForEvent(eventId: string) {
    return this.prisma.client.eventMessageJob.findMany({
      where: { eventId },
      orderBy: { scheduledFor: "asc" },
    });
  }

  // Atomically claim a bounded batch of due jobs under a lease. FOR UPDATE
  // SKIP LOCKED keeps concurrent workers from claiming the same row, and rows
  // whose lease expired (a worker crashed mid-dispatch) become claimable again.
  // ASSIGNMENT_LOCK is ordered first so optional messaging cannot starve it.
  async claimDueJobs(
    leaseOwner: string,
    limit = 50,
    leaseMs: number = DELIVERY_DEFAULTS.leaseMs,
  ): Promise<ClaimedJob[]> {
    const leaseSeconds = Math.ceil(leaseMs / 1000);
    return this.prisma.client.$queryRaw<ClaimedJob[]>`
      UPDATE "EventMessageJob" AS j
      SET "status" = 'PROCESSING',
          "leaseOwner" = ${leaseOwner},
          "leaseExpiresAt" = now() + make_interval(secs => ${leaseSeconds}),
          "attempts" = j."attempts" + 1,
          "updatedAt" = now()
      WHERE j."id" IN (
        SELECT c."id" FROM "EventMessageJob" AS c
        WHERE (c."status" = 'PENDING' AND COALESCE(c."nextAttemptAt", c."scheduledFor") <= now())
           OR (c."status" = 'PROCESSING' AND c."leaseExpiresAt" < now())
        ORDER BY (c."messageType" = 'ASSIGNMENT_LOCK') DESC,
                 COALESCE(c."nextAttemptAt", c."scheduledFor") ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING j."id", j."eventId", j."messageType"::text AS "messageType", j."targetId",
                j."deliveryKey", j."attempts", j."maxAttempts"`;
  }

  // Claim and process due jobs. Each job is dispatched under this worker's
  // lease; outcomes are written conditionally on still holding it.
  async processDueJobs(
    sender: (job: ClaimedJob) => Promise<void | { remoteMessageId?: string }>,
    leaseOwner: string = `worker-${randomUUID()}`,
  ): Promise<{ processed: number; failed: number; retried: number; skipped: number }> {
    const due = await this.claimDueJobs(leaseOwner);

    let processed = 0;
    let failed = 0;
    let retried = 0;
    let skipped = 0;

    for (const job of due) {
      try {
        const result = await sender(job);
        await this.markSent(job.id, leaseOwner, result ? result.remoteMessageId : undefined);
        processed++;
      } catch (err) {
        if (err instanceof SkipDeliveryError) {
          await this.markSkipped(job.id, err.message, leaseOwner);
          skipped++;
          continue;
        }
        const outcome = await this.markFailed(job.id, err, {
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          leaseOwner,
        });
        if (outcome === "RETRY") retried++;
        else failed++;
      }
    }

    return { processed, failed, retried, skipped };
  }
}
