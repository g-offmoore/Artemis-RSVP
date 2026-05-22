import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

/** Returned to callers so they can show remediation state in the web UI. */
export type EventRoleResult =
  | { ok: true; discordRoleId: string }
  | { ok: false; error: string };

@Injectable()
export class DiscordRoleService {
  private readonly logger = new Logger(DiscordRoleService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent: creates the PLAYER Discord role for an event and persists an
   * EventRole record.  A pending record (discordRoleId=null) is created first
   * so the web UI can show "pending" immediately; it is updated once the
   * Discord API call resolves or fails.
   *
   * On failure: marks EventRole.failedAt, stores lastError, and sends a
   * private DM to the event creator so they can remediate manually.
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
      return { ok: true, discordRoleId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err, eventId: event.id }, "Failed to create Discord role for event");

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
    if (role.discordRoleId) return { ok: true, discordRoleId: role.discordRoleId };

    return this.ensureEventRole({
      id: eventId,
      guildId: role.event.guildId,
      title: role.event.title,
      endAt: role.event.endAt,
      createdByDiscordId: role.event.createdByDiscordId,
    });
  }

  async assignRoleToMember(
    guildId: string,
    discordUserId: string,
    discordRoleId: string,
  ): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return;
    await discordApiRequest(
      token,
      `/guilds/${guildId}/members/${discordUserId}/roles/${discordRoleId}`,
      "PUT",
      null,
    ).catch((err) =>
      this.logger.warn({ err, guildId, discordUserId, discordRoleId }, "Failed to assign Discord role to member"),
    );
  }

  /**
   * §12.6: Create the private Discord thread for an event and persist its ID.
   * Idempotent — returns the existing thread if already created.
   * Thread type 12 = PRIVATE_THREAD; requires server boost level 2+ on some guilds.
   * Failures are logged and reported to the organizer; they do not block event creation.
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
      return { ok: true, discordThreadId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err, eventId: event.id }, "Failed to create Discord thread for event");
      await this.notifyOrganizerOfRoleFailure(token, event, `Event thread creation failed: ${error}`);
      return { ok: false, error };
    }
  }

  /** Add a Discord user to the event private thread so they can read and post. */
  async addMemberToThread(discordThreadId: string, discordUserId: string): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return;
    await discordApiRequest(
      token,
      `/channels/${discordThreadId}/thread-members/${discordUserId}`,
      "PUT",
      null,
    ).catch((err) =>
      this.logger.warn({ err, discordThreadId, discordUserId }, "Failed to add member to event thread"),
    );
  }

  /** Post a message to the event thread (e.g. table roster after assignment lock). */
  async postToThread(discordThreadId: string, content: string): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return;
    await discordApiRequest(
      token,
      `/channels/${discordThreadId}/messages`,
      "POST",
      { content },
    ).catch((err) =>
      this.logger.warn({ err, discordThreadId }, "Failed to post message to event thread"),
    );
  }

  async removeRoleFromMember(
    guildId: string,
    discordUserId: string,
    discordRoleId: string,
  ): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return;
    await discordApiRequest(
      token,
      `/guilds/${guildId}/members/${discordUserId}/roles/${discordRoleId}`,
      "DELETE",
      null,
    ).catch((err) =>
      this.logger.warn({ err, guildId, discordUserId, discordRoleId }, "Failed to remove Discord role from member"),
    );
  }

  async processExpiredRoles(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return;

    const expired = await this.prisma.client.eventRole.findMany({
      where: { expiresAt: { lte: new Date() }, deletedAt: null, discordRoleId: { not: null } },
      include: { event: { select: { guildId: true } } },
    });

    for (const role of expired) {
      await discordApiRequest(
        token,
        `/guilds/${role.event.guildId}/roles/${role.discordRoleId!}`,
        "DELETE",
        null,
      ).catch((err) =>
        this.logger.warn({ err, roleId: role.id }, "Failed to delete expired Discord role"),
      );
      await this.prisma.client.eventRole.update({
        where: { id: role.id },
        data: { deletedAt: new Date() },
      });
      this.logger.log({ roleId: role.id }, "Cleaned up expired event role");
    }
  }

  /**
   * Auto-retry failed role and thread creation for events that haven't exceeded
   * 3 attempts. Runs on each cron tick; retries are spaced at least 15 minutes apart.
   * This handles transient Discord API errors (rate limits, temporary outages).
   */
  async retryFailedRolesAndThreads(): Promise<void> {
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
