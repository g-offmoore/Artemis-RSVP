import { Module } from "@nestjs/common";
import { AlertModule } from "../common/alert.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";

@Module({
  imports: [PrismaModule, MetricsModule, AlertModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService]
})
export class EventsModule {}
