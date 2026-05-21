import { Module } from "@nestjs/common";
import { AlertModule } from "../common/alert.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { JobsService } from "./jobs.service.js";

@Module({
  imports: [MetricsModule, AlertModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
