import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class DiscordRoleService {
  private readonly logger = new Logger(DiscordRoleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureEventRole(event: {
    id: string;
    guildId: string;
    title: string;
    endAt: Date;
  }): Promise<string | null> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return null;

    const existing = await this.prisma.client.eventRole.findUnique({
      where: { eventId_roleType: { eventId: event.id, roleType: "PLAYER" } },
    });
    if (existing && !existing.deletedAt) return existing.discordRoleId;

    const roleName = `${event.title.slice(0, 90)} Player`;
    let discordRoleId: string;
    try {
      const role = await discordApiRequest(
        token,
        `/guilds/${event.guildId}/roles`,
        "POST",
        { name: roleName, mentionable: false, permissions: "0" },
      );
      discordRoleId = role.id as string;
    } catch (err) {
      this.logger.warn({ err, eventId: event.id }, "Failed to create Discord role for event");
      return null;
    }

    const expiresAt = new Date(event.endAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    await this.prisma.client.eventRole.upsert({
      where: { eventId_roleType: { eventId: event.id, roleType: "PLAYER" } },
      create: { eventId: event.id, discordRoleId, roleType: "PLAYER", name: roleName, expiresAt },
      update: { discordRoleId, name: roleName, expiresAt, deletedAt: null },
    });

    this.logger.log({ eventId: event.id, discordRoleId }, "Created event player role");
    return discordRoleId;
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
    ).catch((err) => {
      this.logger.warn(
        { err, guildId, discordUserId, discordRoleId },
        "Failed to assign Discord role to member",
      );
    });
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
    ).catch((err) => {
      this.logger.warn(
        { err, guildId, discordUserId, discordRoleId },
        "Failed to remove Discord role from member",
      );
    });
  }

  async processExpiredRoles(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) return;

    const expired = await this.prisma.client.eventRole.findMany({
      where: { expiresAt: { lte: new Date() }, deletedAt: null },
      include: { event: { select: { guildId: true } } },
    });

    for (const role of expired) {
      await discordApiRequest(
        token,
        `/guilds/${role.event.guildId}/roles/${role.discordRoleId}`,
        "DELETE",
        null,
      ).catch((err) => {
        this.logger.warn(
          { err, roleId: role.id, discordRoleId: role.discordRoleId },
          "Failed to delete expired Discord role",
        );
      });
      await this.prisma.client.eventRole.update({
        where: { id: role.id },
        data: { deletedAt: new Date() },
      });
      this.logger.log({ roleId: role.id, discordRoleId: role.discordRoleId }, "Cleaned up expired event role");
    }
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
