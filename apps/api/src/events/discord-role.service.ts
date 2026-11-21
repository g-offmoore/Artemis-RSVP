import { Injectable, Logger } from "@nestjs/common";
import { computeDeliveryBackoffMs, isDiscordNotFound, nextDeliveryState, sanitizeDeliveryError } from "@artemis/domain";
import { PrismaService } from "../prisma/prisma.service.js";
import { MetricsService } from "../metrics/metrics.service.js";

/** Returned to callers so they can show remediation state in the web UI. */
export type EventRoleResult =
  | { ok: true; discordRoleId: string }
  | { ok: false; error: string };

const MEMBERSHIP_MAX_ATTEMPTS = 5;
// A claimed membership row is skipped by other reconcilers for this long.
const MEMBERSHIP_CLAIM_MS = 2 * 60 * 1000;

@Injectable()
export class DiscordRoleService {
  private readonly logger = new Logger(DiscordRoleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Idempotent: creates the PLAYER Discord role for an event and persists an
   * EventRole record.  A pending record (discordRoleId=null) is created first
   * so the web UI can show "pending" immediately; it is updated once the
   * Discord API call resolves or fails.
   *
   * On failure: marks EventRole.failedAt, stores lastError, and sends a
   * private DM to the event creator so they can remediate manually.
   * On success: every member who should have access is queued for
   * reconciliation, so users who RSVPed before the role existed get it.
   */
  async ensureEventRole(event: {
    id: string;
    guildId: string;
    title: string;
    endAt: Date;
    createdByDiscordId: string;
  }): Promise<EventRoleResult> {
    const token = process.env.DISCORD_TOKEN;

    // Already succeeded previously — return the existing role ID.
    const existing = await this.prisma.client.eventRole.findUnique({
      where: { eventId_roleType: { eventId: event.id, roleType: "PLAYER" } },
    });
    if (existing?.discordRoleId && !existing.deletedAt) {
      return { ok: true, discordRoleId: existing.discordRoleId };
    }

    if (!token) {
      const error = "DISCORD_TOKEN not set; cannot create event role";
      await this.upsertFailedRole(event, error);
      await this.notifyOrganizerOfRoleFailure(null, event, error);
      return { ok: false, error };
    }

    const roleName = `${event.title.slice(0, 90)} Player`;
    const cleanupDays = await this.getCleanupDays(event.guildId);
    const expiresAt = new Date(event.endAt.getTime() + cleanupDays * 24 * 60 * 60 * 1000);

    // Create a pending record so the UI shows "pending" before the API call.
    await this.prisma.client.eventRole.upsert({
      where: { eventId_roleType: { eventId: event.id, roleType: "PLAYER" } },
      create: {
        eventId: event.id,
        discordRoleId: null,
        roleType: "PLAYER",
        name: roleName,
        expiresAt,
      },
      update: { name: roleName, expiresAt, failedAt: null, lastError: null },
    });

    try {
      const role = await discordApiRequest(
        token,
        `/guilds/${event.guildId}/roles`,
        "POST",
        { name: roleName, mentionable: false, permissions: "0" },
      );
      const discordRoleId = role.id as string;

      await this.prisma.client.eventRole.update({
        where: { eventId_roleType: { eventId: event.id, roleType: "PLAYER" } },
        data: { discordRoleId, failedAt: null, lastError: null },
      });

      this.logger.log({ eventId: event.id, discordRoleId }, "Created event player role");
      await this.queueEventMemberships(event.id);
      return { ok: true, discordRoleId };
    } catch (err) {
      const error = sanitizeDeliveryError(err instanceof Error ? err.message : String(err));
      this.logger.warn({ err, eventId: event.id }, "Failed to create Discord role for event");
      this.metrics.discordFailures.inc({ operation: "role_create" });

      await this.upsertFailedRole(event, error);
      await this.notifyOrganizerOfRoleFailure(token, event, error);

      return { ok: false, error };
    }
  }

  /** Retry a previously-failed role creation (called from API retry endpoint). */
  async retryEventRole(eventId: string): Promise<EventRoleResult> {
    const role = await this.prisma.client.eventRole.findUnique({
      where: { eventId_roleType: { eventId, roleType: "PLAYER" } },
      include: { event: { select: { guildId: true, title: true, endAt: true, createdByDiscordId: true } } },
    });
    if (!role) return { ok: false, error: "No EventRole record found; publish the event first" };
    if (role.discordRoleId && !role.deletedAt) return { ok: true, discordRoleId: role.discordRoleId };

    return this.ensureEventRole({
      id: eventId,
      guildId: role.event.guildId,
      title: role.event.title,
      endAt: role.event.endAt,
      createdByDiscordId: role.event.createdByDiscordId,
    });
  }

  /**
   * §12.7: Create the private Discord thread for an event and persist its ID.
   * Idempotent — returns the existing thread if already created.
   * Thread type 12 = PRIVATE_THREAD; requires server boost level 2+ on some guilds.
   * Failures are logged and reported to the organizer; they do not block event
   * creation. On success, members who signed up earlier are queued so they
   * are added to the new thread.
   */
  async ensureEventThread(event: {
    id: string;
    guildId: string;
    channelId: string;
    title: string;
    createdByDiscordId: string;
  }): Promise<{ ok: true; discordThreadId: string } | { ok: false; error: string }> {
    const existing = await this.prisma.client.event.findUnique({
      where: { id: event.id },
      select: { discordThreadId: true },
    });
    if (existing?.discordThreadId) {
      return { ok: true, discordThreadId: existing.discordThreadId };
    }

    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      const error = "DISCORD_TOKEN not set; cannot create event thread";
      this.logger.warn({ eventId: event.id }, error);
      return { ok: false, error };
    }

    try {
      const thread = await discordApiRequest(
        token,
        `/channels/${event.channelId}/threads`,
        "POST",
        {
          name: event.title.slice(0, 100),
          type: 12, // PRIVATE_THREAD
          auto_archive_duration: 10080, // 7 days
          invitable: false,
        },
      );
      const discordThreadId = thread.id as string;

      await this.prisma.client.event.update({
        where: { id: event.id },
        data: { discordThreadId },
      });

      this.logger.log({ eventId: event.id, discordThreadId }, "Created event private thread");
      await this.queueEventMemberships(event.id);
      return { ok: true, discordThreadId };
    } catch (err) {
      const error = sanitizeDeliveryError(err instanceof Error ? err.message : String(err));
      this.logger.warn({ err, eventId: event.id }, "Failed to create Discord thread for event");
      this.metrics.discordFailures.inc({ operation: "thread_create" });
      await this.notifyOrganizerOfRoleFailure(token, event, `Event thread creation failed: ${error}`);
      return { ok: false, error };
    }
  }

  /** Staff retry of thread creation; resets the auto-retry budget. */
  async retryEventThread(eventId: string) {
    const event = await this.prisma.client.event.update({
      where: { id: eventId },
      data: { threadRetryCount: 0 },
      select: { id: true, guildId: true, channelId: true, title: true, createdByDiscordId: true },
    });
    return this.ensureEventThread(event);
  }

  /** Post a message to the event thread (e.g. table roster after assignment lock). */
  async postToThread(discordThreadId: string, content: string): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return;
    await discordApiRequest(
      token,
      `/channels/${discordThreadId}/messages`,
      "POST",
      { content, allowed_mentions: { parse: [] } },
    ).catch((err) =>
      this.logger.warn({ err, discordThreadId }, "Failed to post message to event thread"),
    );
  }

  // ─── Membership reconciliation (F04) ────────────────────────────────────

  /**
   * Whether this user should currently hold the event role and thread access:
   * an active primary RSVP (going or waitlisted, any signup role) or hosting a
   * non-cancelled table. Cancelling one reason keeps access if another holds.
   */
  async computeDesiredAccess(eventId: string, discordUserId: string): Promise<boolean> {
    const [rsvp, hostedTable] = await Promise.all([
      this.prisma.client.rSVP.findUnique({
        where: { eventId_primaryDiscordUserId: { eventId, primaryDiscordUserId: discordUserId } },
        select: { status: true },
      }),
      this.prisma.client.eventTable.findFirst({
        where: {
          eventId,
          status: { not: "CANCELLED" },
          ambassadorProfile: { discordUserId },
        },
        select: { id: true },
      }),
    ]);
    return (rsvp != null && (rsvp.status === "GOING" || rsvp.status === "WAITLISTED")) || hostedTable != null;
  }

  /**
   * Record the user's desired access from canonical state and try to apply it
   * now. Never throws: the RSVP or cancel that triggered it always succeeds,
   * and failures stay visible on the row for retry and staff repair.
   */
  async syncMembership(eventId: string, discordUserId: string): Promise<void> {
    try {
      const desired = await this.computeDesiredAccess(eventId, discordUserId);
      const existing = await this.prisma.client.eventDiscordMembership.findUnique({
        where: { eventId_discordUserId: { eventId, discordUserId } },
      });
      // Nothing to grant or revoke for someone who never had access.
      if (!existing && !desired) return;

      const row = await this.prisma.client.eventDiscordMembership.upsert({
        where: { eventId_discordUserId: { eventId, discordUserId } },
        create: { eventId, discordUserId, desired },
        update: { desired, status: "PENDING", attempts: 0, nextAttemptAt: null },
      });
      await this.reconcileMembership(row.id);
    } catch (err) {
      this.logger.warn({ err, eventId, discordUserId }, "Could not sync Discord membership");
    }
  }

  /** Queue every membership row of an event for reconciliation (backfill/repair). */
  async queueEventMemberships(eventId: string): Promise<number> {
    const { count } = await this.prisma.client.eventDiscordMembership.updateMany({
      where: { eventId },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: null },
    });
    return count;
  }

  /**
   * Staff repair: recompute desired access for everyone with an RSVP or table
   * on the event, then queue all rows. Returns how many rows were queued.
   */
  async repairEventMemberships(eventId: string): Promise<{ queued: number }> {
    const [rsvps, tables] = await Promise.all([
      this.prisma.client.rSVP.findMany({ where: { eventId }, select: { primaryDiscordUserId: true } }),
      this.prisma.client.eventTable.findMany({
        where: { eventId, ambassadorProfileId: { not: null } },
        select: { ambassadorProfile: { select: { discordUserId: true } } },
      }),
    ]);
    const users = new Set<string>(rsvps.map((r) => r.primaryDiscordUserId));
    for (const t of tables) if (t.ambassadorProfile) users.add(t.ambassadorProfile.discordUserId);

    for (const discordUserId of users) {
      const desired = await this.computeDesiredAccess(eventId, discordUserId);
      await this.prisma.client.eventDiscordMembership.upsert({
        where: { eventId_discordUserId: { eventId, discordUserId } },
        create: { eventId, discordUserId, desired },
        update: { desired },
      });
    }
    return { queued: await this.queueEventMemberships(eventId) };
  }

  /** Cron: reconcile due PENDING rows. Leaves rows untouched without a token. */
  async reconcilePendingMemberships(limit = 50): Promise<{ synced: number; failed: number }> {
    if (!process.env.DISCORD_TOKEN) return { synced: 0, failed: 0 };
    const now = new Date();
    const due = await this.prisma.client.eventDiscordMembership.findMany({
      where: {
        status: "PENDING",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true },
    });
    let synced = 0;
    let failed = 0;
    for (const { id } of due) {
      const status = await this.reconcileMembership(id);
      if (status === "SYNCED") synced++;
      else if (status === "FAILED") failed++;
    }
    return { synced, failed };
  }

  /**
   * Apply one row's desired state to Discord. Claims the row first with a
   * conditional update so concurrent reconcilers don't both act on it.
   * Removing access treats "already gone" (404) as success; permission
   * errors are recorded, never reported as success.
   */
  async reconcileMembership(id: string): Promise<"SYNCED" | "PENDING" | "FAILED" | "SKIPPED"> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return "SKIPPED";

    const now = new Date();
    const claim = await this.prisma.client.eventDiscordMembership.updateMany({
      where: {
        id,
        status: "PENDING",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      data: { lastAttemptAt: now, nextAttemptAt: new Date(now.getTime() + MEMBERSHIP_CLAIM_MS) },
    });
    if (claim.count === 0) return "SKIPPED";

    const row = await this.prisma.client.eventDiscordMembership.findUniqueOrThrow({
      where: { id },
      include: { event: { select: { guildId: true, discordThreadId: true } } },
    });
    const role = await this.prisma.client.eventRole.findUnique({
      where: { eventId_roleType: { eventId: row.eventId, roleType: "PLAYER" } },
      select: { discordRoleId: true, deletedAt: true },
    });
    const roleId = role?.discordRoleId && !role.deletedAt ? role.discordRoleId : null;
    const threadId = row.event.discordThreadId;
    const { guildId } = row.event;

    try {
      if (row.desired) {
        if (roleId) {
          await discordApiRequest(token, `/guilds/${guildId}/members/${row.discordUserId}/roles/${roleId}`, "PUT", null);
        }
        if (threadId) {
          await discordApiRequest(token, `/channels/${threadId}/thread-members/${row.discordUserId}`, "PUT", null);
        }
      } else {
        if (roleId) {
          await ignoreNotFound(
            discordApiRequest(token, `/guilds/${guildId}/members/${row.discordUserId}/roles/${roleId}`, "DELETE", null),
          );
        }
        if (threadId) {
          await ignoreNotFound(
            discordApiRequest(token, `/channels/${threadId}/thread-members/${row.discordUserId}`, "DELETE", null),
          );
        }
      }

      await this.prisma.client.eventDiscordMembership.update({
        where: { id },
        data: {
          status: "SYNCED",
          roleApplied: row.desired && roleId != null,
          threadApplied: row.desired && threadId != null,
          attempts: 0,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      return "SYNCED";
    } catch (err) {
      this.metrics.discordFailures.inc({ operation: row.desired ? "membership_add" : "membership_remove" });
      const attempts = row.attempts + 1;
      const outcome = nextDeliveryState(attempts, MEMBERSHIP_MAX_ATTEMPTS, err);
      await this.prisma.client.eventDiscordMembership.update({
        where: { id },
        data: {
          attempts,
          lastError: outcome.lastError,
          status: outcome.status,
          nextAttemptAt: outcome.status === "PENDING" ? outcome.nextAttemptAt : null,
        },
      });
      this.logger.warn(
        { eventId: row.eventId, discordUserId: row.discordUserId, status: outcome.status },
        `Discord membership sync failed: ${outcome.lastError}`,
      );
      return outcome.status;
    }
  }

  /** Staff view of one event's Discord state. */
  async eventDiscordStatus(eventId: string) {
    const [event, role, memberships] = await Promise.all([
      this.prisma.client.event.findUnique({
        where: { id: eventId },
        select: { messageId: true, channelId: true, discordThreadId: true, threadRetryCount: true },
      }),
      this.prisma.client.eventRole.findUnique({
        where: { eventId_roleType: { eventId, roleType: "PLAYER" } },
      }),
      this.prisma.client.eventDiscordMembership.findMany({
        where: { eventId },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    const count = (status: string) => memberships.filter((m) => m.status === status).length;
    return {
      post: { channelId: event?.channelId ?? null, messageId: event?.messageId ?? null },
      thread: { discordThreadId: event?.discordThreadId ?? null, retryCount: event?.threadRetryCount ?? 0 },
      role: role
        ? {
            discordRoleId: role.discordRoleId,
            failedAt: role.failedAt,
            lastError: role.lastError,
            expiresAt: role.expiresAt,
            deletedAt: role.deletedAt,
            cleanupAttempts: role.cleanupAttempts,
          }
        : null,
      memberships: {
        synced: count("SYNCED"),
        pending: count("PENDING"),
        failed: count("FAILED"),
        problems: memberships
          .filter((m) => m.status !== "SYNCED")
          .map((m) => ({
            discordUserId: m.discordUserId,
            desired: m.desired,
            status: m.status,
            attempts: m.attempts,
            lastError: m.lastError,
            nextAttemptAt: m.nextAttemptAt,
          })),
      },
    };
  }

  // ─── Role cleanup ───────────────────────────────────────────────────────

  /**
   * Delete expired event roles. deletedAt is set only when Discord confirms the
   * delete or reports the role already gone; any other failure (for example a
   * role above the bot's) is recorded and retried later with backoff.
   */
  async processExpiredRoles(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return;

    const now = new Date();
    const expired = await this.prisma.client.eventRole.findMany({
      where: {
        expiresAt: { lte: now },
        deletedAt: null,
        discordRoleId: { not: null },
        OR: [{ cleanupNextAttemptAt: null }, { cleanupNextAttemptAt: { lte: now } }],
      },
      include: { event: { select: { guildId: true } } },
      take: 25,
    });

    for (const role of expired) {
      try {
        await ignoreNotFound(
          discordApiRequest(token, `/guilds/${role.event.guildId}/roles/${role.discordRoleId!}`, "DELETE", null),
        );
        await this.prisma.client.eventRole.update({
          where: { id: role.id },
          data: { deletedAt: new Date(), cleanupNextAttemptAt: null },
        });
        this.logger.log({ roleId: role.id }, "Cleaned up expired event role");
      } catch (err) {
        const attempts = role.cleanupAttempts + 1;
        const message = sanitizeDeliveryError(err instanceof Error ? err.message : String(err));
        this.metrics.discordFailures.inc({ operation: "role_delete" });
        await this.prisma.client.eventRole.update({
          where: { id: role.id },
          data: {
            cleanupAttempts: attempts,
            lastError: `Cleanup failed: ${message}`.slice(0, 500),
            cleanupNextAttemptAt: new Date(Date.now() + computeDeliveryBackoffMs(attempts)),
          },
        });
        this.logger.warn({ roleId: role.id, attempts }, `Failed to delete expired Discord role: ${message}`);
      }
    }
  }

  /**
   * Auto-retry failed role and thread creation for events that haven't exceeded
   * 3 attempts. Runs on each cron tick; retries are spaced at least 15 minutes apart.
   * This handles transient Discord API errors (rate limits, temporary outages).
   */
  async retryFailedRolesAndThreads(): Promise<void> {
    if (!process.env.DISCORD_TOKEN) return;
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    // Retry failed roles (failedAt set, discordRoleId null, retryCount < 3).
    const failedRoles = await this.prisma.client.eventRole.findMany({
      where: {
        failedAt: { not: null, lte: fifteenMinutesAgo },
        discordRoleId: null,
        deletedAt: null,
        retryCount: { lt: 3 },
      },
      include: {
        event: { select: { id: true, guildId: true, title: true, endAt: true, createdByDiscordId: true } },
      },
      take: 10,
    });

    for (const role of failedRoles) {
      await this.prisma.client.eventRole.update({
        where: { id: role.id },
        data: { retryCount: { increment: 1 } },
      });
      const result = await this.ensureEventRole(role.event);
      this.logger.log(
        { eventId: role.event.id, ok: result.ok },
        `Auto-retry event role (attempt ${(role.retryCount ?? 0) + 1})`,
      );
    }

    // Retry events whose thread is missing (discordThreadId null, created > 15 min ago).
    const eventsWithoutThread = await this.prisma.client.event.findMany({
      where: {
        discordThreadId: null,
        status: { notIn: ["CANCELLED", "ARCHIVED"] },
        createdAt: { lte: fifteenMinutesAgo },
        threadRetryCount: { lt: 3 },
      },
      select: {
        id: true, guildId: true, channelId: true, title: true, createdByDiscordId: true,
        threadRetryCount: true,
      },
      take: 10,
    });

    for (const event of eventsWithoutThread) {
      await this.prisma.client.event.update({
        where: { id: event.id },
        data: { threadRetryCount: { increment: 1 } },
      });
      const result = await this.ensureEventThread(event);
      this.logger.log(
        { eventId: event.id, ok: result.ok },
        `Auto-retry event thread (attempt ${(event.threadRetryCount ?? 0) + 1})`,
      );
    }
  }

  private async getCleanupDays(guildId: string): Promise<number> {
    const settings = await this.prisma.client.guildSettings.findUnique({
      where: { guildId },
      select: { temporaryRoleCleanupDays: true },
    });
    return settings?.temporaryRoleCleanupDays ?? 7;
  }

  private async upsertFailedRole(
    event: { id: string; title: string; endAt: Date; guildId: string },
    error: string,
  ) {
    const cleanupDays = await this.getCleanupDays(event.guildId);
    const expiresAt = new Date(event.endAt.getTime() + cleanupDays * 24 * 60 * 60 * 1000);
    await this.prisma.client.eventRole.upsert({
      where: { eventId_roleType: { eventId: event.id, roleType: "PLAYER" } },
      create: {
        eventId: event.id,
        discordRoleId: null,
        roleType: "PLAYER",
        name: `${event.title.slice(0, 90)} Player`,
        expiresAt,
        failedAt: new Date(),
        lastError: error.slice(0, 500),
      },
      update: { failedAt: new Date(), lastError: error.slice(0, 500) },
    });
  }

  private async notifyOrganizerOfRoleFailure(
    token: string | null,
    event: { id: string; title: string; createdByDiscordId: string },
    error: string,
  ) {
    if (!token) {
      this.logger.warn({ eventId: event.id }, "Cannot notify organizer — no DISCORD_TOKEN");
      return;
    }
    const content =
      `⚠️ **Event role creation failed — ${event.title}**\n\n` +
      `Artemis could not create the Discord player role for this event.\n` +
      `**Error:** ${error.slice(0, 300)}\n\n` +
      `**Event ID:** ${event.id}\n` +
      `Use the web dashboard to retry role creation or manually link an existing role.`;
    await discordDmPost(token, event.createdByDiscordId, content).catch((dmErr) =>
      this.logger.warn({ dmErr, eventId: event.id }, "Could not DM organizer about role failure"),
    );
  }
}

// ─── Discord REST helpers ─────────────────────────────────────────────────

async function ignoreNotFound<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (err) {
    if (isDiscordNotFound(err)) return null;
    throw err;
  }
}

async function discordApiRequest(
  token: string,
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      authorization: `Bot ${token}`,
      ...(body != null ? { "content-type": "application/json" } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Discord API ${response.status} (${path}): ${text.slice(0, 300)}`);
  }

  const text = await response.text().catch(() => "");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function discordDmPost(token: string, userId: string, content: string): Promise<void> {
  const dmChannel = await discordApiRequest(token, "/users/@me/channels", "POST", {
    recipient_id: userId,
  });
  await discordApiRequest(token, `/channels/${dmChannel.id as string}/messages`, "POST", { content });
}
