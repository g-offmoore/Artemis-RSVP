import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AlertService } from "./common/alert.service.js";
import { ApiTokenGuard } from "./common/api-token.guard.js";
import { EventsModule } from "./events/events.module.js";
import { HealthController } from "./health/health.controller.js";
import { JobsService } from "./jobs/jobs.service.js";
import { MetricsService } from "./metrics/metrics.service.js";
import { PrismaService } from "./prisma/prisma.service.js";

@Module({
  imports: [EventsModule],
  controllers: [HealthController],
  providers: [
    PrismaService,
    MetricsService,
    AlertService,
    JobsService,
    {
      provide: APP_GUARD,
      useClass: ApiTokenGuard
    }
  ]
})
export class AppModule {}
