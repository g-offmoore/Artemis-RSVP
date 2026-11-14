import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { MetricsService } from "../metrics/metrics.service.js";
import {
  buildEventButtonRows,
  buildEventEmbed,
  type EventEmbedDescriptor,
  type EventPresentationInput,
} from "@artemis/domain/event-presentation";

type DiscordEmbed = EventEmbedDescriptor;

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
  private readonly logger = new Logger(DiscordEventPostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

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
        eventType: true,
      },
    });
    if (!event) throw new NotFoundException("Event not found");

    const payload = {
      embeds: [eventEmbed(event)],
      components: eventButtons(event),
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
      this.metrics.discordFailures.inc({ operation: "post_publish" });
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

export function eventEmbed(event: EventPresentationInput): DiscordEmbed {
  return buildEventEmbed(event);
}

// Maps the shared button descriptors onto Discord REST component payloads.
// Cancelled events get no components: stale buttons must not stay clickable.
export function eventButtons(
  event: Parameters<typeof buildEventButtonRows>[0],
): DiscordComponent[] {
  return buildEventButtonRows(event).map((row) => ({
    type: 1 as const,
    components: row.map((b) => ({
      type: 2 as const,
      style: b.style,
      label: b.label,
      custom_id: b.customId,
    })),
  }));
}
