import { Module } from "@nestjs/common";
import { AlertService } from "../common/alert.service.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";

@Module({
  controllers: [EventsController],
  providers: [EventsService, PrismaService, MetricsService, AlertService],
  exports: [EventsService]
})
export class EventsModule {}
