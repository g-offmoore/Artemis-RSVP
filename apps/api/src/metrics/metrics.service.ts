import { Injectable } from "@nestjs/common";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests: Counter<string>;
  readonly httpLatency: Histogram<string>;
  readonly discordFailures: Counter<string>;
  readonly assignmentFailures: Counter<string>;
  readonly jobFailures: Counter<string>;
  readonly dbConnections: Gauge<string>;
  readonly dbConnectionLimit: Gauge<string>;
  readonly oldestPendingJobAgeSeconds: Gauge<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: "artemis_" });

    this.httpRequests = new Counter({
      name: "artemis_http_requests_total",
      help: "HTTP requests by route and status.",
      labelNames: ["method", "route", "status"],
      registers: [this.registry]
    });

    this.httpLatency = new Histogram({
      name: "artemis_http_request_duration_seconds",
      help: "HTTP request duration by route.",
      labelNames: ["method", "route", "status"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry]
    });

    this.discordFailures = new Counter({
      name: "artemis_discord_failures_total",
      help: "Discord operation failures.",
      labelNames: ["operation"],
      registers: [this.registry]
    });

    this.assignmentFailures = new Counter({
      name: "artemis_assignment_failures_total",
      help: "Assignment run failures.",
      registers: [this.registry]
    });

    this.jobFailures = new Counter({
      name: "artemis_job_failures_total",
      help: "Background job failures.",
      labelNames: ["job"],
      registers: [this.registry]
    });

    this.dbConnections = new Gauge({
      name: "artemis_db_connections",
      help: "Active PostgreSQL connections for the current database.",
      registers: [this.registry]
    });

    this.dbConnectionLimit = new Gauge({
      name: "artemis_db_connection_limit",
      help: "Configured PostgreSQL plan connection limit.",
      registers: [this.registry]
    });

    this.oldestPendingJobAgeSeconds = new Gauge({
      name: "artemis_oldest_pending_job_age_seconds",
      help: "Age of the oldest pending background job.",
      labelNames: ["queue"],
      registers: [this.registry]
    });
  }
}
