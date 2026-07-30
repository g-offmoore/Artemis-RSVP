import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { GuildSettingsService } from "./guild-settings.service.js";

const DEFAULT_EVENT_TYPES: Array<{ key: string; name: string; defaultGameSystem: string }> = [
  { key: "dnd_session_night", name: "D&D Session Night", defaultGameSystem: "D&D" },
  { key: "daggerheart", name: "Daggerheart", defaultGameSystem: "Daggerheart" },
  { key: "board_game", name: "Board Game", defaultGameSystem: "Board Game" },
];

@Injectable()
export class GuildOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guildSettings: GuildSettingsService,
  ) {}

  /**
   * Idempotent: safe to call again on bot restart/rejoin. Ensures a guild has a
   * GuildSettings row and the default event-type catalog to create events/series from.
   */
  async onboardGuild(guildId: string) {
    const settings = await this.guildSettings.get(guildId);
    const eventTypes = await Promise.all(
      DEFAULT_EVENT_TYPES.map((template) =>
        this.prisma.client.eventType.upsert({
          where: { guildId_key: { guildId, key: template.key } },
          create: { guildId, ...template },
          update: {},
        }),
      ),
    );
    return { settings, eventTypes };
  }
}
