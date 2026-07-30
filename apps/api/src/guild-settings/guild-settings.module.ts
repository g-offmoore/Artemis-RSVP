import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { GuildChannelsService } from "./guild-channels.service.js";
import { GuildOnboardingService } from "./guild-onboarding.service.js";
import { GuildSettingsController } from "./guild-settings.controller.js";
import { GuildSettingsService } from "./guild-settings.service.js";
import { GuildsController } from "./guilds.controller.js";

@Module({
  imports: [PrismaModule],
  controllers: [GuildSettingsController, GuildsController],
  providers: [GuildSettingsService, GuildOnboardingService, GuildChannelsService],
  exports: [GuildSettingsService, GuildOnboardingService, GuildChannelsService],
})
export class GuildSettingsModule {}
