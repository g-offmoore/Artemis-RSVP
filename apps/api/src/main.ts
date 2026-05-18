import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./common/env.js";

const logger = new Logger("Bootstrap");

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: true }));

  await app.register(helmet, {
    contentSecurityPolicy: false
  });
  await app.register(cors, {
    origin: env.NODE_ENV === "production" ? false : true
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute"
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  );

  await app.listen(env.PORT, "0.0.0.0");
  logger.log(`Artemis API listening on ${env.PORT}`);
}

bootstrap().catch((error) => {
  logger.error("API bootstrap failed", error);
  process.exit(1);
});
