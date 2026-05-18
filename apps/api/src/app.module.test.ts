import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { describe, expect, it } from "vitest";
import { AppModule } from "./app.module.js";

describe("AppModule", () => {
  it("resolves the Nest dependency graph with production providers", async () => {
    process.env.ARTEMIS_STARTUP_CHECK = "true";
    process.env.DATABASE_URL ??= "postgresql://artemis_app:password@localhost:5432/artemis";

    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), {
      logger: false
    });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true
      })
    );

    await app.init();
    expect(app).toBeDefined();
    await app.close();
  });
});
