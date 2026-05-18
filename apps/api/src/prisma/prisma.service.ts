import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createPrismaClient, parsePositiveInt, PrismaClient } from "@artemis/db";

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  constructor() {
    this.client = createPrismaClient({
      max: parsePositiveInt(process.env.DATABASE_POOL_MAX, 5),
      logQueries: process.env.LOG_SQL === "true"
    });
  }

  async onModuleInit() {
    if (process.env.ARTEMIS_STARTUP_CHECK === "true") {
      this.logger.log("Skipping PostgreSQL connection for startup check");
      return;
    }

    await this.client.$connect();
    this.logger.log("Connected to PostgreSQL");
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
