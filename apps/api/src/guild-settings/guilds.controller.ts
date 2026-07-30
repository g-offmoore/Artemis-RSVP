import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { GuildDirectoryRoute, PathGuildIdScopeGuard } from "../common/guild-scope.guard.js";
import { GuildChannelsService } from "./guild-channels.service.js";
import { GuildOnboardingService } from "./guild-onboarding.service.js";
import { GuildSettingsService } from "./guild-settings.service.js";

@Controller("api/v1/guilds")
@UseGuards(PathGuildIdScopeGuard)
export class GuildsController {
  constructor(
    private readonly guildSettings: GuildSettingsService,
    private readonly onboarding: GuildOnboardingService,
    private readonly channels: GuildChannelsService,
  ) {}

  // Directory of every guild Artemis manages — used to bootstrap web dashboard login
  // before the caller has an active guild selected. Not guild-scoped by design.
  // NOTE: this is a full, unfiltered directory. Callers MUST NOT expose this response
  // directly to a browser — the web app filters it server-side against the caller's
  // own session.guilds/isPlatformAdmin before anything reaches the client.
  @Get()
  @GuildDirectoryRoute()
  list() {
    return this.guildSettings.listManagedGuilds();
  }

  @Post(":guildId/onboard")
  onboard(@Param("guildId") guildId: string) {
    return this.onboarding.onboardGuild(guildId);
  }

  @Get(":guildId/channels")
  listChannels(@Param("guildId") guildId: string) {
    return this.channels.listChannels(guildId);
  }
}
