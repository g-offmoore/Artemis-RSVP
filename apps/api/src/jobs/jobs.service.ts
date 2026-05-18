import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PgBoss } from "pg-boss";
import { normalizeNodePostgresConnectionString } from "@artemis/db";
import { AlertService } from "../common/alert.service.js";
import { MetricsService } from "../metrics/metrics.service.js";

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private boss?: PgBoss;

  constructor(
    private readonly alerts: AlertService,
    private readonly metrics: MetricsService
  ) {}

  async onModuleInit() {
    if (process.env.ARTEMIS_STARTUP_CHECK === "true") {
      this.logger.log("Skipping pg-boss start for startup check");
      return;
    }

    this.boss = new PgBoss({
      connectionString: normalizeNodePostgresConnectionString(process.env.DATABASE_URL ?? ""),
      max: Number.parseInt(process.env.PGBOSS_POOL_MAX ?? "2", 10),
      schema: process.env.PGBOSS_SCHEMA ?? "pgboss",
      migrate: false,
      createSchema: false
    });

    this.boss.on("error", (error: Error) => {
      this.metrics.jobFailures.inc({ job: "pg-boss" });
      void this.alerts.sendOpsAlert("pg-boss error", { message: error.message });
    });

    await this.boss.start();
    this.logger.log("pg-boss started with low-concurrency defaults");
  }

  async onModuleDestroy() {
    await this.boss?.stop();
  }

  get client() {
    if (!this.boss) throw new Error("Job runner has not started");
    return this.boss;
  }

  isReady() {
    return Boolean(this.boss);
  }
}
