import { Module } from "@nestjs/common";
import { AlertModule } from "../common/alert.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { DiscordEventPostService } from "./discord-event-post.service.js";
import { DiscordRoleService } from "./discord-role.service.js";
import { EventSeriesController } from "./event-series.controller.js";
import { EventSeriesService } from "./event-series.service.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";
import { MessageJobsService } from "./message-jobs.service.js";
import { MessageJobWorkerService } from "./message-job-worker.service.js";

@Module({
  imports: [PrismaModule, MetricsModule, AlertModule, JobsModule],
  controllers: [EventsController, EventSeriesController],
  providers: [
    EventsService,
    DiscordEventPostService,
    DiscordRoleService,
    MessageJobsService,
    MessageJobWorkerService,
    EventSeriesService,
  ],
  exports: [EventsService, DiscordEventPostService, DiscordRoleService, MessageJobsService, EventSeriesService],
})
export class EventsModule {}
