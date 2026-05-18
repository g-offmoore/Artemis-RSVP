import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AlertModule } from "./common/alert.module.js";
import { ApiTokenGuard } from "./common/api-token.guard.js";
import { ZodExceptionFilter } from "./common/zod-exception.filter.js";
import { EventsModule } from "./events/events.module.js";
import { HealthController } from "./health/health.controller.js";
import { JobsService } from "./jobs/jobs.service.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({
  imports: [PrismaModule, MetricsModule, AlertModule, EventsModule],
  controllers: [HealthController],
  providers: [
    JobsService,
    {
      provide: APP_GUARD,
      useClass: ApiTokenGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ZodExceptionFilter,
    },
  ],
})
export class AppModule {}
