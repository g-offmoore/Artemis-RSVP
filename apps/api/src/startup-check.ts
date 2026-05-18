import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./common/env.js";

process.env.ARTEMIS_STARTUP_CHECK = "true";

async function checkStartup() {
  loadEnv();
  await import("class-transformer");
  await import("class-validator");

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
  await app.close();
}

checkStartup().catch((error) => {
  console.error(error);
  process.exit(1);
});
