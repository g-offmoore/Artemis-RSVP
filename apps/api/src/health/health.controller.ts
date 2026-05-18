import { Controller, ForbiddenException, Get, Header, Query } from "@nestjs/common";
import { Public } from "../common/public.decorator.js";
import { MetricsService } from "../metrics/metrics.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService
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
    return { ok: true, database: "reachable" };
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
