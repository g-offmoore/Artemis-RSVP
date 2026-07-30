import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { GuildDirectoryRoute, PathGuildIdScopeGuard } from "../common/guild-scope.guard.js";
import { GuildOnboardingService } from "./guild-onboarding.service.js";
import { GuildSettingsService } from "./guild-settings.service.js";

@Controller("api/v1/guilds")
@UseGuards(PathGuildIdScopeGuard)
export class GuildsController {
  constructor(
    private readonly guildSettings: GuildSettingsService,
    private readonly onboarding: GuildOnboardingService,
  ) {}

  // Directory of every guild Artemis manages — used to bootstrap web dashboard login
  // before the caller has an active guild selected. Not guild-scoped by design.
  @Get()
  @GuildDirectoryRoute()
  list() {
    return this.guildSettings.listManagedGuildIds();
  }

  @Post(":guildId/onboard")
  onboard(@Param("guildId") guildId: string) {
    return this.onboarding.onboardGuild(guildId);
  }
}
