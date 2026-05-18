import { Module } from "@nestjs/common";
import { AlertModule } from "../common/alert.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { DiscordEventPostService } from "./discord-event-post.service.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";

@Module({
  imports: [PrismaModule, MetricsModule, AlertModule],
  controllers: [EventsController],
  providers: [EventsService, DiscordEventPostService],
  exports: [EventsService, DiscordEventPostService],
})
export class EventsModule {}
