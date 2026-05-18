import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

type DiscordEmbed = {
  title: string;
  description?: string;
  image?: { url: string };
  fields: Array<{ name: string; value: string; inline?: boolean }>;
};

type DiscordComponent = {
  type: 1;
  components: Array<{
    type: 2;
    style: 1 | 2 | 3 | 4;
    label: string;
    custom_id: string;
  }>;
};

@Injectable()
export class DiscordEventPostService {
  constructor(private readonly prisma: PrismaService) {}

  async publishEventPost(eventId: string, actorDiscordId: string) {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException(
        "DISCORD_TOKEN is required to publish Discord event posts",
      );
    }

    const event = await this.prisma.client.event.findUnique({
      where: { id: eventId },
      include: {
        tables: true,
        participants: true,
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    const payload = {
      embeds: [eventEmbed(event)],
      components: [eventButtons(event)],
    };

    try {
      const existingMessageId = event.messageId;
      const response = existingMessageId
        ? await discordRequest(
            token,
            `/channels/${event.channelId}/messages/${existingMessageId}`,
            "PATCH",
            payload,
          ).catch((error) => {
            if (error instanceof DiscordApiError && error.status === 404)
              return null;
            throw error;
          })
        : null;

      const message =
        response ??
        (await discordRequest(
          token,
          `/channels/${event.channelId}/messages`,
          "POST",
          payload,
        ));

      const messageId = stringField(message, "id");
      await this.prisma.client.event.update({
        where: { id: eventId },
        data: {
          messageId,
          auditLogs: {
            create: {
              guildId: event.guildId,
              actorDiscordId,
              action:
                existingMessageId && response
                  ? "discord_post.updated"
                  : "discord_post.published",
              afterValue: { channelId: event.channelId, messageId },
            },
          },
        },
      });

      return { ok: true, channelId: event.channelId, messageId };
    } catch (error) {
      await this.prisma.client.auditLog.create({
        data: {
          guildId: event.guildId,
          eventId,
          actorDiscordId,
          action: "discord_post.failed",
          afterValue: {
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });
      throw new BadGatewayException(
        error instanceof Error ? error.message : "Discord post failed",
      );
    }
  }
}

class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

async function discordRequest(
  token: string,
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new DiscordApiError(
      response.status,
      `Discord API ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function stringField(value: Record<string, unknown>, field: string) {
  const output = value[field];
  if (typeof output !== "string" || !output) {
    throw new DiscordApiError(502, `Discord response did not include ${field}`);
  }
  return output;
}

function eventEmbed(event: {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  gameSystem: string;
  status: string;
  startAt: Date;
  endAt: Date;
  tables: Array<{ status: string; softCap: number; hardCap: number }>;
  participants: Array<{ participantType: string; assignmentEligible: boolean }>;
}): DiscordEmbed {
  const counts = eventCounts(event);
  const capacity = eventCapacity(event);
  const vocabulary = eventVocabulary(event);
  const embed: DiscordEmbed = {
    title: event.title,
    description: event.description ?? "Store event",
    fields: [
      {
        name: "When",
        value: formatDiscordTimeRange(event.startAt, event.endAt),
      },
      {
        name: "Registered",
        value: `${vocabulary.attendeePlural}: ${counts.players}\nGuests: ${counts.guests}\n${vocabulary.hostPlural}: ${counts.hosts}`,
        inline: true,
      },
      {
        name: "Capacity",
        value: capacity.hardCap
          ? `${counts.players + counts.guests}/${capacity.hardCap} seats\n${capacity.tables} tables`
          : `No ${vocabulary.hostSingular.toLowerCase()} tables yet`,
        inline: true,
      },
      { name: "Status", value: event.status ?? "SCHEDULED", inline: true },
      { name: "Event ID", value: event.id, inline: true },
    ],
  };

  if (event.imageUrl) embed.image = { url: event.imageUrl };
  return embed;
}

function eventButtons(event: {
  id: string;
  gameSystem: string;
}): DiscordComponent {
  const vocabulary = eventVocabulary(event);
  const buttons = vocabulary.usesDndCategories
    ? [
        button(`rsvp:${event.id}:NORMAL`, "RSVP Normal", 3),
        button(`rsvp:${event.id}:HEROIC`, "RSVP Heroic", 1),
      ]
    : [button(`rsvp:${event.id}:MIXED`, "RSVP", 3)];

  buttons.push(
    button(`guest:${event.id}`, "Guests", 2),
    button(`host:${event.id}`, vocabulary.hostButtonLabel, 2),
    button(`assignment:${event.id}`, "My Assignment", 2),
  );

  return { type: 1, components: buttons };
}

function button(custom_id: string, label: string, style: 1 | 2 | 3 | 4) {
  return { type: 2 as const, style, label, custom_id };
}

function eventCounts(event: {
  tables: Array<{ status: string }>;
  participants: Array<{ participantType: string; assignmentEligible: boolean }>;
}) {
  const participants = event.participants.filter(
    (participant) => participant.assignmentEligible !== false,
  );
  return {
    players: participants.filter(
      (participant) => participant.participantType === "PRIMARY",
    ).length,
    guests: participants.filter(
      (participant) => participant.participantType === "GUEST",
    ).length,
    hosts: activeTables(event).length,
  };
}

function eventCapacity(event: {
  tables: Array<{ status: string; softCap: number; hardCap: number }>;
}) {
  const tables = activeTables(event);
  return {
    tables: tables.length,
    softCap: tables.reduce((sum, table) => sum + (table.softCap ?? 0), 0),
    hardCap: tables.reduce((sum, table) => sum + (table.hardCap ?? 0), 0),
  };
}

function activeTables<T extends { status: string }>(event: {
  tables: T[];
}): T[] {
  return event.tables.filter(
    (table) => !["CANCELLED", "COMPLETED"].includes(table.status),
  );
}

function formatDiscordTimeRange(startAt: Date, endAt: Date) {
  return `${formatDiscordTimestamp(startAt, "F")} to ${formatDiscordTimestamp(endAt, "t")}\n${formatDiscordTimestamp(startAt, "R")}`;
}

function formatDiscordTimestamp(value: Date, style: "F" | "R" | "t") {
  return `<t:${Math.floor(value.getTime() / 1000)}:${style}>`;
}

function eventVocabulary(event: { gameSystem?: string }) {
  const gameSystem = event.gameSystem?.trim().toLowerCase() ?? "";
  if (
    gameSystem === "d&d" ||
    gameSystem === "dnd" ||
    gameSystem.includes("dungeons")
  ) {
    return {
      usesDndCategories: true,
      attendeePlural: "Players",
      hostSingular: "DM",
      hostPlural: "DMs",
      hostButtonLabel: "DM Signup",
    };
  }

  if (gameSystem === "daggerheart") {
    return {
      usesDndCategories: false,
      attendeePlural: "Attendees",
      hostSingular: "GM",
      hostPlural: "GMs",
      hostButtonLabel: "GM Signup",
    };
  }

  return {
    usesDndCategories: false,
    attendeePlural: "Attendees",
    hostSingular: "Ambassador",
    hostPlural: "Ambassadors",
    hostButtonLabel: "Ambassador Signup",
  };
}
