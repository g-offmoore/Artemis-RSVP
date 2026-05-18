import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { GuildSettingsController } from "./guild-settings.controller.js";
import { GuildSettingsService } from "./guild-settings.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [GuildSettingsController],
  providers: [GuildSettingsService],
  exports: [GuildSettingsService],
})
export class GuildSettingsModule {}
