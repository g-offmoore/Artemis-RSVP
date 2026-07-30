import { Body, Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { PathGuildIdScopeGuard } from "../common/guild-scope.guard.js";
import { GuildSettingsService } from "./guild-settings.service.js";

@Controller("api/v1/guild-settings")
@UseGuards(PathGuildIdScopeGuard)
export class GuildSettingsController {
  constructor(private readonly guildSettings: GuildSettingsService) {}

  @Get()
  get(@Query("guildId") guildId: string) {
    return this.guildSettings.get(guildId);
  }

  @Patch(":guildId")
  update(@Param("guildId") guildId: string, @Body() body: unknown) {
    return this.guildSettings.update(guildId, body);
  }
}
