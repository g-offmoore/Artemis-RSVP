import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

export type GuildChannelSummary = { id: string; name: string };

// GUILD_TEXT and GUILD_ANNOUNCEMENT — the only channel types Artemis can post
// event messages/threads into.
const POSTABLE_CHANNEL_TYPES = new Set([0, 5]);

@Injectable()
export class GuildChannelsService {
  private readonly logger = new Logger(GuildChannelsService.name);

  /** Live per-request: there is no onboarding hook for channels the way there is for guild names. */
  async listChannels(guildId: string): Promise<GuildChannelSummary[]> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException("DISCORD_TOKEN not set; cannot list channels");
    }

    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { authorization: `Bot ${token}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      this.logger.warn({ guildId, status: response.status, text }, "Failed to list Discord channels");
      throw new ServiceUnavailableException(`Discord API ${response.status} listing channels`);
    }

    const channels = (await response.json()) as Array<{ id: string; name: string; type: number }>;
    return channels
      .filter((channel) => POSTABLE_CHANNEL_TYPES.has(channel.type))
      .map((channel) => ({ id: channel.id, name: channel.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
