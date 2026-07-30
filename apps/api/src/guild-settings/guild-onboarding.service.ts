import { Injectable } from "@nestjs/common";
import { GuildSettingsService } from "./guild-settings.service.js";

@Injectable()
export class GuildOnboardingService {
  constructor(private readonly guildSettings: GuildSettingsService) {}

  /**
   * Idempotent: safe to call again on bot restart/rejoin. Ensures a guild has a
   * GuildSettings row. EventType rows are no longer seeded here — every event
   * and series creates its own independent EventType on demand, so there is no
   * shared catalog left to pre-populate.
   */
  async onboardGuild(guildId: string) {
    const settings = await this.guildSettings.get(guildId);
    return { settings };
  }
}
