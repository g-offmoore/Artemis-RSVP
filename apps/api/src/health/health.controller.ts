import { Controller, ForbiddenException, Get, Header, Query, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../common/public.decorator.js";
import { JobsService } from "../jobs/jobs.service.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly jobs: JobsService
  ) {}

  @Public()
  @Get("healthz")
  healthz() {
    return { ok: true, service: "artemis-api" };
  }

  @Public()
  @Get("readyz")
  async readyz() {
    await this.prisma.client.$queryRaw`SELECT 1`;
    if (!this.jobs.isReady()) {
      throw new ServiceUnavailableException({ ok: false, database: "reachable", jobs: "not_ready" });
    }

    return { ok: true, database: "reachable", jobs: "ready" };
  }

  @Public()
  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  async metricsEndpoint(@Query("token") token?: string) {
    const expected = process.env.METRICS_TOKEN;
    if (!expected || token !== expected) {
      throw new ForbiddenException("Metrics are not public");
    }

    return this.metrics.registry.metrics();
  }
}
